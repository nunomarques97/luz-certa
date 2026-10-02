using System.Globalization;

namespace OmiePrices;

/// <summary>Portuguese marginal prices of one OMIE market day, in published period order.</summary>
public sealed record OmieDay(DateOnly Date, int Resolution, IReadOnlyList<decimal> Prices);

public static class Price
{
    public const decimal Min = -1000m;
    public const decimal Max = 10000m;

    public static decimal Round(decimal value)
    {
        var rounded = Math.Round(value, 2, MidpointRounding.AwayFromZero);
        return rounded == 0m ? 0m : rounded;
    }

    public static string Format(decimal value) => Round(value).ToString("0.##", CultureInfo.InvariantCulture);
}
