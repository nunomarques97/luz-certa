namespace OmiePrices;

public sealed record FetchResult(int AddedDays, DateOnly? LastDay, bool FilesChanged);

/// <summary>
/// Downloads every missing market day from <c>from</c> up to the latest published one and rewrites the data files.
/// All downloads are parsed before anything is written, so a rejected file leaves the existing JSON untouched.
/// </summary>
public sealed class PriceFetcher(IOmieSource source, TimeProvider clock, TextWriter log)
{
    public static readonly DateOnly BackfillStart = new(2024, 1, 1);

    public async Task<FetchResult> RunAsync(string dataDir, DateOnly from, CancellationToken cancellationToken)
    {
        var days = PriceStore.Load(dataDir);
        var today = MarketCalendar.MadridDate(clock.GetUtcNow());
        // Day-ahead auction: the furthest day that can be published is tomorrow in Spanish time.
        var horizon = today.AddDays(1);
        var added = 0;

        for (var day = from; day <= horizon; day = day.AddDays(1))
        {
            if (days.ContainsKey(day)) continue;

            var content = await source.GetDayFileAsync(day, cancellationToken);
            if (content is null)
            {
                if (day > today)
                {
                    log.WriteLine($"{PriceStore.IsoDate(day)}: not available yet");
                    break;
                }
                throw new OmieSourceException(
                    $"{PriceStore.IsoDate(day)}: OMIE answers HTTP 404 for a day that should already be published (Spanish date today is {PriceStore.IsoDate(today)})");
            }

            days[day] = OmieDayFile.Parse(content, day);
            added++;
            log.WriteLine($"{PriceStore.IsoDate(day)}: {days[day].Prices.Count} periods of {days[day].Resolution} min");
        }

        if (days.Count == 0) return new FetchResult(0, null, false);

        var changed = false;
        var years = days.Keys.Select(day => day.Year).Distinct().ToList();
        foreach (var year in years)
            changed |= PriceStore.WriteIfChanged(
                Path.Combine(dataDir, PriceStore.YearFileName(year)), PriceStore.SerializeYear(year, days.Values));
        changed |= PriceStore.WriteIfChanged(
            Path.Combine(dataDir, PriceStore.IndexFileName),
            PriceStore.SerializeIndex(years, days.Keys.First(), days.Keys.Last()));

        return new FetchResult(added, days.Keys.Last(), changed);
    }
}
