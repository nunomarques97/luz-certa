namespace OmiePrices.Tests;

public class DataVerifierTests
{
    private static readonly DateOnly From = Fixture.Date("2024-01-15");

    private static async Task<TempDir> ValidData()
    {
        var dir = new TempDir();
        var source = new FakeOmieSource().WithDays("2024-01-15", "2024-01-16");
        await new PriceFetcher(source, FixedClock.MadridNoon("2024-01-15"), TextWriter.Null).RunAsync(dir.Path, From, CancellationToken.None);
        return dir;
    }

    private static Task<int> RunCli(params string[] args) =>
        Cli.RunAsync(args, () => throw new InvalidOperationException("verify must stay offline"), TimeProvider.System, TextWriter.Null, TextWriter.Null);

    [Fact]
    public async Task Passes_on_complete_data_and_cli_exits_zero()
    {
        using var dir = await ValidData();

        Assert.Empty(DataVerifier.Verify(dir.Path, From));
        Assert.Equal(Cli.Ok, await RunCli("verify", "--data", dir.Path, "--from", "2024-01-15"));
    }

    [Fact]
    public async Task Fails_when_data_does_not_start_on_the_backfill_day()
    {
        using var dir = await ValidData();

        Assert.Contains(DataVerifier.Verify(dir.Path, Fixture.Date("2024-01-01")), problem => problem.Contains("expected 2024-01-01"));
        Assert.Equal(Cli.Failed, await RunCli("verify", "--data", dir.Path));
    }

    [Fact]
    public async Task Fails_on_a_missing_day()
    {
        using var dir = await ValidData();
        var json = File.ReadAllText(dir.File("2024.json"));
        var start = json.IndexOf("\"2024-01-15\"", StringComparison.Ordinal);
        var end = json.IndexOf("\"2024-01-16\"", StringComparison.Ordinal);
        File.WriteAllText(dir.File("2024.json"), json.Remove(start, end - start));

        Assert.Contains(DataVerifier.Verify(dir.Path, From), problem => problem.Contains("expected 2024-01-15"));
    }

    [Fact]
    public async Task Fails_on_a_gap_between_days()
    {
        using var dir = await ValidData();
        var json = File.ReadAllText(dir.File("2024.json")).Replace("\"2024-01-16\"", "\"2024-01-18\"");
        File.WriteAllText(dir.File("2024.json"), json);
        File.WriteAllText(dir.File("index.json"), PriceStore.SerializeIndex([2024], From, Fixture.Date("2024-01-18")));

        var problems = DataVerifier.Verify(dir.Path, From);

        Assert.Contains(problems, problem => problem.Contains("2 missing day(s)") && problem.Contains("2024-01-16, 2024-01-17"));
    }

    [Fact]
    public async Task Fails_on_a_wrong_period_count_or_resolution()
    {
        using var dir = await ValidData();
        var json = File.ReadAllText(dir.File("2024.json"));
        var tampered = json.Replace("{\"res\":60,\"p\":[-0.2,", "{\"res\":15,\"p\":[");
        Assert.NotEqual(json, tampered);
        File.WriteAllText(dir.File("2024.json"), tampered);

        var problems = DataVerifier.Verify(dir.Path, From);

        Assert.Contains(problems, problem => problem.Contains("res is 15, expected 60"));
        Assert.Contains(problems, problem => problem.Contains("23 prices, expected 24"));
    }

    [Fact]
    public async Task Fails_on_non_canonical_files()
    {
        using var dir = await ValidData();
        File.WriteAllText(dir.File("2024.json"), File.ReadAllText(dir.File("2024.json")).Replace("\n", "\r\n"));

        Assert.Contains(DataVerifier.Verify(dir.Path, From), problem => problem.Contains("canonical"));
    }

    [Fact]
    public async Task Fails_on_a_stale_or_missing_index()
    {
        using var dir = await ValidData();
        File.WriteAllText(dir.File("index.json"), PriceStore.SerializeIndex([2024], From, From));
        Assert.Contains(DataVerifier.Verify(dir.Path, From), problem => problem.StartsWith("index.json: does not match"));

        File.Delete(dir.File("index.json"));
        Assert.Contains(DataVerifier.Verify(dir.Path, From), problem => problem == "index.json: missing");
    }

    [Fact]
    public async Task Fails_on_a_leftover_temporary_file_or_unreadable_year()
    {
        using var dir = await ValidData();
        File.WriteAllText(dir.File(".2024.json.abc.tmp"), "partial");
        File.WriteAllText(dir.File("2023.json"), "{ not json");

        var problems = DataVerifier.Verify(dir.Path, From);

        Assert.Contains(problems, problem => problem.Contains("leftover temporary file"));
        Assert.Contains(problems, problem => problem.StartsWith("2023.json:"));
    }

    [Fact]
    public async Task Fails_on_an_empty_or_missing_directory()
    {
        using var dir = new TempDir();

        Assert.Equal(["no price data found"], DataVerifier.Verify(dir.Path, From));
        Assert.Equal(Cli.Failed, await RunCli("verify", "--data", dir.File("absent")));
    }

    [Theory]
    [InlineData]
    [InlineData("publish")]
    [InlineData("verify", "--data")]
    [InlineData("verify", "--from", "15/01/2024")]
    public async Task Cli_rejects_bad_usage(params string[] args)
    {
        Assert.Equal(Cli.Usage, await RunCli(args));
    }
}
