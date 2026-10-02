using System.Text.Json;

namespace OmiePrices.Tests;

public class PriceFetcherTests
{
    private static Task<FetchResult> Fetch(TempDir dir, IOmieSource source, string today, string from) =>
        new PriceFetcher(source, FixedClock.MadridNoon(today), TextWriter.Null).RunAsync(dir.Path, Fixture.Date(from), CancellationToken.None);

    private static JsonElement Json(string path) => JsonDocument.Parse(File.ReadAllText(path)).RootElement;

    [Fact]
    public async Task Writes_the_year_file_and_index_in_the_output_contract()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15", "2024-01-16");

        var result = await Fetch(dir, source, today: "2024-01-15", from: "2024-01-15");

        Assert.Equal(2, result.AddedDays);
        Assert.True(result.FilesChanged);
        var year = Json(dir.File("2024.json"));
        Assert.Equal(1, year.GetProperty("schema").GetInt32());
        Assert.Equal("OMIE marginalpdbcpt", year.GetProperty("source").GetString());
        Assert.Equal("EUR/MWh", year.GetProperty("unit").GetString());
        Assert.Equal("PT", year.GetProperty("zone").GetString());
        var day = year.GetProperty("days").GetProperty("2024-01-15");
        Assert.Equal(60, day.GetProperty("res").GetInt32());
        Assert.Equal(24, day.GetProperty("p").GetArrayLength());
        Assert.Equal(10.9m, day.GetProperty("p")[3].GetDecimal());
        Assert.Equal(
            "{\"schema\":1,\"years\":[2024],\"first_day\":\"2024-01-15\",\"last_day\":\"2024-01-16\"}\n",
            File.ReadAllText(dir.File("index.json")));
    }

    [Fact]
    public async Task Handles_the_switch_from_hourly_to_quarter_hour_periods_on_2025_10_01()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2025-09-30", "2025-10-01");

        await Fetch(dir, source, today: "2025-09-30", from: "2025-09-30");

        var days = Json(dir.File("2025.json")).GetProperty("days");
        Assert.Equal(60, days.GetProperty("2025-09-30").GetProperty("res").GetInt32());
        Assert.Equal(24, days.GetProperty("2025-09-30").GetProperty("p").GetArrayLength());
        Assert.Equal(15, days.GetProperty("2025-10-01").GetProperty("res").GetInt32());
        Assert.Equal(96, days.GetProperty("2025-10-01").GetProperty("p").GetArrayLength());
        Assert.Empty(DataVerifier.Verify(dir.Path, Fixture.Date("2025-09-30")));
    }

    [Theory]
    [InlineData("2024-03-31", 60, 23)]
    [InlineData("2024-10-27", 60, 25)]
    [InlineData("2026-03-29", 15, 92)]
    [InlineData("2025-10-26", 15, 100)]
    public async Task Stores_DST_short_and_long_days_with_all_published_periods(string iso, int resolution, int periods)
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays(iso);

        await Fetch(dir, source, today: iso, from: iso);

        var day = Json(dir.File($"{iso[..4]}.json")).GetProperty("days").GetProperty(iso);
        Assert.Equal(resolution, day.GetProperty("res").GetInt32());
        Assert.Equal(periods, day.GetProperty("p").GetArrayLength());
        Assert.Empty(DataVerifier.Verify(dir.Path, Fixture.Date(iso)));
    }

    [Fact]
    public async Task Treats_404_for_the_next_day_as_not_available_yet()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15");
        var log = new StringWriter();

        var result = await new PriceFetcher(source, FixedClock.MadridNoon("2024-01-15"), log)
            .RunAsync(dir.Path, Fixture.Date("2024-01-15"), CancellationToken.None);

        Assert.Equal(Fixture.Date("2024-01-15"), result.LastDay);
        Assert.Equal([Fixture.Date("2024-01-15"), Fixture.Date("2024-01-16")], source.Requests);
        Assert.Contains("2024-01-16: not available yet", log.ToString());
        Assert.True(File.Exists(dir.File("2024.json")));
    }

    [Fact]
    public async Task Never_requests_beyond_the_day_ahead_horizon()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15", "2024-01-16");

        await Fetch(dir, source, today: "2024-01-15", from: "2024-01-15");

        Assert.Equal(Fixture.Date("2024-01-16"), source.Requests.Max());
    }

    [Fact]
    public async Task Fails_without_writing_when_an_already_published_day_is_404()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15");

        await Assert.ThrowsAsync<OmieSourceException>(() => Fetch(dir, source, today: "2024-01-16", from: "2024-01-15"));

        Assert.Empty(Directory.EnumerateFileSystemEntries(dir.Path));
    }

    [Fact]
    public async Task Rerun_without_new_data_leaves_files_byte_identical_and_untouched()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15", "2024-01-16");
        await Fetch(dir, source, today: "2024-01-15", from: "2024-01-15");
        var before = dir.Snapshot();
        source.Requests.Clear();

        var result = await Fetch(dir, source, today: "2024-01-15", from: "2024-01-15");

        Assert.Equal(0, result.AddedDays);
        Assert.False(result.FilesChanged);
        Assert.Empty(source.Requests);
        var after = dir.Snapshot();
        Assert.Equal(before.Keys.Order(), after.Keys.Order());
        foreach (var (name, file) in before)
        {
            Assert.Equal(file.Bytes, after[name].Bytes);
            Assert.Equal(file.Written, after[name].Written);
        }
    }

    [Fact]
    public async Task Incremental_run_appends_only_the_new_day()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15", "2024-01-16");
        await Fetch(dir, source, today: "2024-01-14", from: "2024-01-15");
        Assert.Equal("2024-01-15", Json(dir.File("index.json")).GetProperty("last_day").GetString());
        source.Requests.Clear();

        var result = await Fetch(dir, source, today: "2024-01-15", from: "2024-01-15");

        Assert.Equal(1, result.AddedDays);
        Assert.Equal([Fixture.Date("2024-01-16")], source.Requests);
        Assert.Equal("2024-01-16", Json(dir.File("index.json")).GetProperty("last_day").GetString());
        Assert.Empty(DataVerifier.Verify(dir.Path, Fixture.Date("2024-01-15")));
    }

    [Theory]
    [InlineData("truncated_20240116.1")]
    [InlineData("no-end-marker_20240116.1")]
    [InlineData("missing-period_20240116.1")]
    [InlineData("comma-decimal_20240116.1")]
    [InlineData("html-page_20240116.1")]
    public async Task Malformed_download_is_rejected_without_touching_existing_json(string file)
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15");
        await Fetch(dir, source, today: "2024-01-14", from: "2024-01-15");
        var before = dir.Snapshot();
        source.Files[Fixture.Date("2024-01-16")] = Fixture.Read("malformed/" + file);

        await Assert.ThrowsAsync<OmieFormatException>(() => Fetch(dir, source, today: "2024-01-16", from: "2024-01-15"));

        var after = dir.Snapshot();
        Assert.Equal(before.Keys.Order(), after.Keys.Order());
        foreach (var (name, entry) in before)
        {
            Assert.Equal(entry.Bytes, after[name].Bytes);
            Assert.Equal(entry.Written, after[name].Written);
        }
    }

    [Fact]
    public async Task Splits_days_into_one_file_per_year()
    {
        using var dir = new TempDir();
        var source = new FakeOmieSource();
        var dec31 = Fixture.Date("2024-12-31");
        var jan1 = Fixture.Date("2025-01-01");
        source.Files[dec31] = Fixture.Day(Fixture.Date("2024-01-15")).Replace("2024;01;15;", "2024;12;31;");
        source.Files[jan1] = Fixture.Day(Fixture.Date("2024-01-15")).Replace("2024;01;15;", "2025;01;01;");

        await Fetch(dir, source, today: "2024-12-31", from: "2024-12-31");

        Assert.True(Json(dir.File("2024.json")).GetProperty("days").TryGetProperty("2024-12-31", out _));
        Assert.True(Json(dir.File("2025.json")).GetProperty("days").TryGetProperty("2025-01-01", out _));
        Assert.Equal(
            "{\"schema\":1,\"years\":[2024,2025],\"first_day\":\"2024-12-31\",\"last_day\":\"2025-01-01\"}\n",
            File.ReadAllText(dir.File("index.json")));
    }
}
