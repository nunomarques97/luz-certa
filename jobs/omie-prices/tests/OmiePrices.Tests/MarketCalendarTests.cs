namespace OmiePrices.Tests;

public class MarketCalendarTests
{
    [Theory]
    [InlineData("2024-01-15", 60, 24)]
    [InlineData("2024-03-31", 60, 23)]
    [InlineData("2024-10-27", 60, 25)]
    [InlineData("2025-03-30", 60, 23)]
    [InlineData("2025-09-30", 60, 24)]
    [InlineData("2025-10-01", 15, 96)]
    [InlineData("2025-10-26", 15, 100)]
    [InlineData("2026-03-29", 15, 92)]
    [InlineData("2026-10-25", 15, 100)]
    public void Resolution_and_period_count_follow_the_switch_and_DST(string day, int resolution, int periods)
    {
        Assert.Equal(resolution, MarketCalendar.ResolutionMinutes(Fixture.Date(day)));
        Assert.Equal(periods, MarketCalendar.PeriodCount(Fixture.Date(day)));
    }

    [Theory]
    [InlineData("2026-01-15T22:59:59Z", "2026-01-15")]
    [InlineData("2026-01-15T23:00:00Z", "2026-01-16")]
    [InlineData("2026-07-15T21:59:59Z", "2026-07-15")]
    [InlineData("2026-07-15T22:00:00Z", "2026-07-16")]
    [InlineData("2026-03-29T00:59:59Z", "2026-03-29")]
    [InlineData("2026-10-24T22:00:00Z", "2026-10-25")]
    [InlineData("2026-10-25T22:59:59Z", "2026-10-25")]
    [InlineData("2026-10-25T23:00:00Z", "2026-10-26")]
    public void MadridDate_uses_CET_and_CEST(string instant, string expected)
    {
        Assert.Equal(Fixture.Date(expected), MarketCalendar.MadridDate(DateTimeOffset.Parse(instant, System.Globalization.CultureInfo.InvariantCulture)));
    }
}
