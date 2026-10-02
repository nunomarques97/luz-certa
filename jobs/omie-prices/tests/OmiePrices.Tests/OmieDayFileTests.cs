namespace OmiePrices.Tests;

public class OmieDayFileTests
{
    [Theory]
    [InlineData("2024-01-15", 60, 24)]
    [InlineData("2024-03-31", 60, 23)]
    [InlineData("2024-10-27", 60, 25)]
    [InlineData("2025-09-30", 60, 24)]
    [InlineData("2025-10-01", 15, 96)]
    [InlineData("2025-10-26", 15, 100)]
    [InlineData("2026-03-29", 15, 92)]
    public void Parses_hourly_and_quarter_hour_files_including_DST_days(string iso, int resolution, int periods)
    {
        var day = Fixture.Date(iso);

        var parsed = OmieDayFile.Parse(Fixture.Day(day), day);

        Assert.Equal(day, parsed.Date);
        Assert.Equal(resolution, parsed.Resolution);
        Assert.Equal(periods, parsed.Prices.Count);
    }

    [Fact]
    public void Takes_the_Portuguese_column_in_published_period_order()
    {
        var day = Fixture.Date("2024-01-15");

        var prices = OmieDayFile.Parse(Fixture.Day(day), day).Prices;

        // Period 4 differs between Portugal (10.9) and Spain (18.15) in the fixture.
        Assert.Equal([-0.2m, 3.5m, 0m, 10.9m, -0.5m, 18.3m, 20m], prices.Take(7));
    }

    [Fact]
    public void Rounds_prices_to_two_decimals()
    {
        var day = Fixture.Date("2024-01-15");
        var rows = Enumerable.Range(1, 24).Select(period => period switch
        {
            1 => "2024;01;15;1;1.005;0;",
            2 => "2024;01;15;2;-0.004;0;",
            3 => "2024;01;15;3;-2.345;0;",
            _ => $"2024;01;15;{period};50;50;",
        });
        var content = "MARGINALPDBCPT;\n" + string.Join("\n", rows) + "\n*\n";

        var prices = OmieDayFile.Parse(content, day).Prices;

        Assert.Equal([1.01m, 0m, -2.35m], prices.Take(3));
        Assert.Equal("0", Price.Format(prices[1]));
    }

    [Theory]
    [InlineData("truncated_20240116.1", "2024-01-16", "end marker")]
    [InlineData("no-end-marker_20240116.1", "2024-01-16", "end marker")]
    [InlineData("missing-period_20240116.1", "2024-01-16", "expected 24 periods")]
    [InlineData("comma-decimal_20240116.1", "2024-01-16", "dot-decimal")]
    [InlineData("bad-price_20240116.1", "2024-01-16", "dot-decimal")]
    [InlineData("out-of-range_20240116.1", "2024-01-16", "outside")]
    [InlineData("wrong-date_20240116.1", "2024-01-16", "date does not match")]
    [InlineData("period-order_20240116.1", "2024-01-16", "expected period 5")]
    [InlineData("html-page_20240116.1", "2024-01-16", "header")]
    [InlineData("hourly-after-switch_20251002.1", "2025-10-02", "expected 96 periods")]
    [InlineData("quarter-hour-before-switch_20250930.1", "2025-09-30", "expected 24 periods")]
    [InlineData("long-day-as-normal_20241027.1", "2024-10-27", "expected 25 periods")]
    public void Rejects_malformed_or_truncated_files(string file, string iso, string reason)
    {
        var error = Assert.Throws<OmieFormatException>(() => OmieDayFile.Parse(Fixture.Read("malformed/" + file), Fixture.Date(iso)));

        Assert.Contains(reason, error.Message);
    }

    [Theory]
    [InlineData("MARGINALPDBC;", true)]
    [InlineData("MARGINALPDBCPT;", true)]
    [InlineData("MARGINALPIBC;", false)]
    [InlineData("", false)]
    public void Accepts_only_the_Portugal_and_Iberian_headers(string header, bool accepted)
    {
        var day = Fixture.Date("2024-01-15");
        var content = Fixture.Day(day).Replace("MARGINALPDBCPT;", header);

        if (accepted) Assert.Equal(24, OmieDayFile.Parse(content, day).Prices.Count);
        else Assert.Throws<OmieFormatException>(() => OmieDayFile.Parse(content, day));
    }

    [Fact]
    public void Rejects_a_file_served_for_another_day()
    {
        Assert.Throws<OmieFormatException>(() =>
            OmieDayFile.Parse(Fixture.Day(Fixture.Date("2024-01-15")), Fixture.Date("2024-01-16")));
    }

    [Fact]
    public void Rejects_oversized_content()
    {
        Assert.Throws<OmieFormatException>(() =>
            OmieDayFile.Parse(new string('x', OmieDayFile.MaxLength + 1), Fixture.Date("2024-01-16")));
    }
}
