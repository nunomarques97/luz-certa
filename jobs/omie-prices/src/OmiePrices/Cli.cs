using System.Globalization;

namespace OmiePrices;

public static class Cli
{
    public const int Ok = 0;
    public const int Failed = 1;
    public const int Usage = 2;
    public const string DefaultDataDir = "web/public/data/omie";

    private const string UsageText = """
        Usage:
          OmiePrices fetch  [--data <dir>] [--from yyyy-MM-dd]   download missing OMIE days and update the JSON
          OmiePrices verify [--data <dir>] [--from yyyy-MM-dd]   offline completeness and shape check
        Defaults: --data web/public/data/omie, --from 2024-01-01
        """;

    public static async Task<int> RunAsync(
        string[] args, Func<IOmieSource> sourceFactory, TimeProvider clock, TextWriter output, TextWriter error,
        CancellationToken cancellationToken = default)
    {
        if (args.Length == 0)
        {
            error.WriteLine(UsageText);
            return Usage;
        }
        if (!TryReadOptions(args.AsSpan(1), out var dataDir, out var from, out var problem))
        {
            error.WriteLine($"{problem}\n{UsageText}");
            return Usage;
        }

        switch (args[0])
        {
            case "fetch":
                try
                {
                    var result = await new PriceFetcher(sourceFactory(), clock, output).RunAsync(dataDir, from, cancellationToken);
                    output.WriteLine(result.LastDay is { } last
                        ? $"fetch: {result.AddedDays} new day(s), latest day {PriceStore.IsoDate(last)}, files {(result.FilesChanged ? "updated" : "unchanged")}"
                        : "fetch: no data published yet");
                    return Ok;
                }
                catch (Exception ex) when (ex is OmieFormatException or OmieSourceException or StoreFormatException or IOException or HttpRequestException)
                {
                    error.WriteLine($"fetch failed: {ex.Message}");
                    return Failed;
                }

            case "verify":
                var problems = DataVerifier.Verify(dataDir, from);
                foreach (var line in problems) error.WriteLine($"verify: {line}");
                if (problems.Count > 0) return Failed;
                output.WriteLine($"verify: {dataDir} is complete and well formed");
                return Ok;

            default:
                error.WriteLine($"Unknown command '{args[0]}'.\n{UsageText}");
                return Usage;
        }
    }

    private static bool TryReadOptions(ReadOnlySpan<string> args, out string dataDir, out DateOnly from, out string problem)
    {
        dataDir = DefaultDataDir;
        from = PriceFetcher.BackfillStart;
        problem = "";
        for (var i = 0; i < args.Length; i += 2)
        {
            if (i + 1 >= args.Length)
            {
                problem = $"Missing value for {args[i]}.";
                return false;
            }
            switch (args[i])
            {
                case "--data":
                    dataDir = args[i + 1];
                    break;
                case "--from" when DateOnly.TryParseExact(args[i + 1], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date):
                    from = date;
                    break;
                default:
                    problem = $"Invalid option {args[i]} {args[i + 1]}.";
                    return false;
            }
        }
        return true;
    }
}
