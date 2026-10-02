namespace OmiePrices;

/// <summary>
/// OMIE market days follow Spanish legal time (CET/CEST, EU summer-time rules).
/// Day-ahead periods were hourly until 2025-09-30 and quarter-hourly from 2025-10-01.
/// </summary>
public static class MarketCalendar
{
    public static readonly DateOnly QuarterHourStart = new(2025, 10, 1);

    public static int ResolutionMinutes(DateOnly day) => day < QuarterHourStart ? 60 : 15;

    /// <summary>23 on the spring transition day, 25 on the autumn one, otherwise 24.</summary>
    public static int HoursInDay(DateOnly day)
    {
        if (day == LastSunday(day.Year, 3)) return 23;
        if (day == LastSunday(day.Year, 10)) return 25;
        return 24;
    }

    public static int PeriodCount(DateOnly day) => HoursInDay(day) * 60 / ResolutionMinutes(day);

    public static DateOnly LastSunday(int year, int month)
    {
        var last = new DateOnly(year, month, DateTime.DaysInMonth(year, month));
        return last.AddDays(-(int)last.DayOfWeek);
    }

    /// <summary>Spanish civil date at an instant. Summer time runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October.</summary>
    public static DateOnly MadridDate(DateTimeOffset instant)
    {
        var utc = instant.UtcDateTime;
        var summerStart = LastSunday(utc.Year, 3).ToDateTime(new TimeOnly(1, 0));
        var summerEnd = LastSunday(utc.Year, 10).ToDateTime(new TimeOnly(1, 0));
        var offsetHours = utc >= summerStart && utc < summerEnd ? 2 : 1;
        return DateOnly.FromDateTime(utc.AddHours(offsetHours));
    }
}
