using System.Text;

namespace OmiePrices;

/// <summary>Offline completeness and shape check of the published data directory.</summary>
public static class DataVerifier
{
    private const int MaxListedDays = 10;

    public static IReadOnlyList<string> Verify(string dir, DateOnly firstDay)
    {
        if (!Directory.Exists(dir)) return [$"{dir}: directory not found"];

        var problems = new List<string>();
        foreach (var temp in Directory.EnumerateFiles(dir, "*.tmp"))
            problems.Add($"{Path.GetFileName(temp)}: leftover temporary file");

        var days = new SortedDictionary<DateOnly, OmieDay>();
        var years = new List<int>();
        foreach (var (year, path) in PriceStore.YearFiles(dir))
        {
            var name = PriceStore.YearFileName(year);
            var text = Encoding.UTF8.GetString(File.ReadAllBytes(path));
            List<OmieDay> yearDays;
            try
            {
                yearDays = PriceStore.ReadYear(text, year);
            }
            catch (StoreFormatException ex)
            {
                problems.Add(ex.Message);
                continue;
            }

            years.Add(year);
            if (yearDays.Count == 0) problems.Add($"{name}: holds no days");
            if (PriceStore.SerializeYear(year, yearDays) != text)
                problems.Add($"{name}: not in the canonical compact form written by fetch");
            foreach (var day in yearDays)
            {
                CheckDay(day, problems);
                days[day.Date] = day;
            }
        }

        if (days.Count == 0)
        {
            problems.Add("no price data found");
            return problems;
        }

        var first = days.Keys.First();
        var last = days.Keys.Last();
        if (first != firstDay)
            problems.Add($"data starts on {PriceStore.IsoDate(first)}, expected {PriceStore.IsoDate(firstDay)}");

        var missing = new List<DateOnly>();
        for (var day = firstDay; day <= last; day = day.AddDays(1))
            if (!days.ContainsKey(day)) missing.Add(day);
        if (missing.Count > 0)
            problems.Add($"{missing.Count} missing day(s) up to {PriceStore.IsoDate(last)}: "
                + string.Join(", ", missing.Take(MaxListedDays).Select(PriceStore.IsoDate))
                + (missing.Count > MaxListedDays ? ", ..." : ""));

        var indexPath = Path.Combine(dir, PriceStore.IndexFileName);
        var expectedIndex = PriceStore.SerializeIndex(years, first, last);
        if (!File.Exists(indexPath))
            problems.Add($"{PriceStore.IndexFileName}: missing");
        else if (Encoding.UTF8.GetString(File.ReadAllBytes(indexPath)) != expectedIndex)
            problems.Add($"{PriceStore.IndexFileName}: does not match the year files (expected {expectedIndex.TrimEnd()})");

        return problems;
    }

    private static void CheckDay(OmieDay day, List<string> problems)
    {
        var date = PriceStore.IsoDate(day.Date);
        var resolution = MarketCalendar.ResolutionMinutes(day.Date);
        if (day.Resolution != resolution)
            problems.Add($"{date}: res is {day.Resolution}, expected {resolution}");

        var count = MarketCalendar.PeriodCount(day.Date);
        if (day.Prices.Count != count)
            problems.Add($"{date}: {day.Prices.Count} prices, expected {count}");

        for (var i = 0; i < day.Prices.Count; i++)
        {
            var price = day.Prices[i];
            if (price < Price.Min || price > Price.Max || Price.Round(price) != price)
            {
                problems.Add($"{date}: period {i + 1} price {price} is out of range or has more than 2 decimals");
                break;
            }
        }
    }
}
