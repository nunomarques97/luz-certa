using System.Globalization;

namespace OmiePrices;

public sealed class OmieFormatException(string message) : Exception(message);

/// <summary>
/// Parser for the public OMIE file marginalpdbcpt_YYYYMMDD.1:
/// a "MARGINALPDBCPT;" header, one "year;month;day;period;PT price;ES price;" row per period
/// (semicolon separated, dot decimal) and a closing "*" line.
/// The Iberian file marginalpdbc_YYYYMMDD.1 has the same rows under a "MARGINALPDBC;" header and is accepted too.
/// </summary>
public static class OmieDayFile
{
    public const int MaxLength = 64 * 1024;
    public const string PortugalFile = "marginalpdbcpt";
    public const string IberianFile = "marginalpdbc";
    private static readonly string[] Headers = ["MARGINALPDBCPT;", "MARGINALPDBC;"];
    private const string EndMarker = "*";

    public static string FileName(DateOnly day, string file = PortugalFile) =>
        $"{file}_{day.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}.1";

    public static OmieDay Parse(string content, DateOnly day)
    {
        if (content.Length > MaxLength)
            throw Fail(day, $"file is larger than {MaxLength} characters");

        var lines = content.TrimStart('\uFEFF').Split('\n').Select(line => line.TrimEnd('\r')).ToList();
        while (lines.Count > 0 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1);

        if (lines.Count == 0 || !Headers.Contains(lines[0]))
            throw Fail(day, "missing MARGINALPDBCPT or MARGINALPDBC header");
        if (lines[^1] != EndMarker)
            throw Fail(day, "missing '*' end marker (truncated file)");

        var expected = MarketCalendar.PeriodCount(day);
        var found = lines.Count - 2;
        if (found != expected)
            throw Fail(day, $"expected {expected} periods of {MarketCalendar.ResolutionMinutes(day)} minutes, found {found}");

        var prices = new decimal[expected];
        for (var i = 0; i < expected; i++)
        {
            var lineNumber = i + 2;
            var fields = lines[i + 1].Split(';');
            if (fields.Length != 7 || fields[6].Length != 0)
                throw Fail(day, $"line {lineNumber}: expected 6 semicolon-terminated fields");

            if (!DateOnly.TryParseExact($"{fields[0]};{fields[1]};{fields[2]}", "yyyy;MM;dd",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var rowDay) || rowDay != day)
                throw Fail(day, $"line {lineNumber}: date does not match the requested day");

            if (!int.TryParse(fields[3], NumberStyles.None, CultureInfo.InvariantCulture, out var period) || period != i + 1)
                throw Fail(day, $"line {lineNumber}: expected period {i + 1}");

            var portugal = ReadPrice(fields[4], day, lineNumber);
            ReadPrice(fields[5], day, lineNumber);
            prices[i] = Price.Round(portugal);
        }

        return new OmieDay(day, MarketCalendar.ResolutionMinutes(day), prices);
    }

    private static decimal ReadPrice(string text, DateOnly day, int lineNumber)
    {
        if (!decimal.TryParse(text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out var value))
            throw Fail(day, $"line {lineNumber}: '{Truncate(text)}' is not a dot-decimal price");
        if (value < Price.Min || value > Price.Max)
            throw Fail(day, $"line {lineNumber}: price {value} is outside {Price.Min}..{Price.Max} EUR/MWh");
        return value;
    }

    private static string Truncate(string text) => text.Length <= 20 ? text : text[..20] + "...";

    private static OmieFormatException Fail(DateOnly day, string reason) =>
        new($"{FileName(day)}: {reason}");
}
