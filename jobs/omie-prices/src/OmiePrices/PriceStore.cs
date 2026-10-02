using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace OmiePrices;

public sealed class StoreFormatException(string message) : Exception(message);

/// <summary>
/// Reads and writes web/public/data/omie: one &lt;year&gt;.json per year plus index.json.
/// Output is canonical (one day per line, LF endings), so unchanged data serializes to identical bytes.
/// </summary>
public static partial class PriceStore
{
    public const int Schema = 1;
    public const string Source = "OMIE marginalpdbcpt";
    public const string Unit = "EUR/MWh";
    public const string Zone = "PT";
    public const string IndexFileName = "index.json";

    public static string YearFileName(int year) => $"{year}.json";

    public static IEnumerable<(int Year, string Path)> YearFiles(string dir)
    {
        if (!Directory.Exists(dir)) return [];
        return Directory.EnumerateFiles(dir, "*.json")
            .Select(path => (Match: YearFilePattern().Match(Path.GetFileName(path)), Path: path))
            .Where(file => file.Match.Success)
            .Select(file => (Year: int.Parse(file.Match.Groups[1].Value, CultureInfo.InvariantCulture), file.Path))
            .OrderBy(file => file.Year)
            .ToList();
    }

    public static SortedDictionary<DateOnly, OmieDay> Load(string dir)
    {
        var days = new SortedDictionary<DateOnly, OmieDay>();
        foreach (var (year, path) in YearFiles(dir))
            foreach (var day in ReadYear(File.ReadAllText(path, Encoding.UTF8), year))
                days.Add(day.Date, day);
        return days;
    }

    /// <summary>Parses one year file and checks its shape. Market-calendar rules are checked by <see cref="DataVerifier"/>.</summary>
    public static List<OmieDay> ReadYear(string json, int year)
    {
        var name = YearFileName(year);
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            RequireKeys(root, name, "schema", "source", "unit", "zone", "days");
            if (root.GetProperty("schema").GetInt32() != Schema)
                throw new StoreFormatException($"{name}: unsupported schema");
            RequireString(root, "source", Source, name);
            RequireString(root, "unit", Unit, name);
            RequireString(root, "zone", Zone, name);

            var days = new List<OmieDay>();
            var seen = new HashSet<DateOnly>();
            foreach (var property in root.GetProperty("days").EnumerateObject())
            {
                if (!DateOnly.TryParseExact(property.Name, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                    || date.Year != year)
                    throw new StoreFormatException($"{name}: '{property.Name}' is not a day of {year}");
                if (!seen.Add(date))
                    throw new StoreFormatException($"{name}: {property.Name} appears twice");

                var entry = property.Value;
                RequireKeys(entry, $"{name} {property.Name}", "res", "p");
                var resolution = entry.GetProperty("res").GetInt32();
                if (resolution is not (15 or 60))
                    throw new StoreFormatException($"{name} {property.Name}: res must be 15 or 60");
                var prices = entry.GetProperty("p").EnumerateArray().Select(price => price.GetDecimal()).ToList();
                days.Add(new OmieDay(date, resolution, prices));
            }
            return days;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException or KeyNotFoundException)
        {
            throw new StoreFormatException($"{name}: {ex.Message}");
        }
    }

    public static string SerializeYear(int year, IEnumerable<OmieDay> days)
    {
        var builder = new StringBuilder();
        builder.Append($"{{\"schema\":{Schema},\"source\":\"{Source}\",\"unit\":\"{Unit}\",\"zone\":\"{Zone}\",\"days\":{{");
        var first = true;
        foreach (var day in days.Where(day => day.Date.Year == year).OrderBy(day => day.Date))
        {
            builder.Append(first ? "\n" : ",\n");
            first = false;
            builder.Append('"').Append(IsoDate(day.Date)).Append("\":{\"res\":")
                .Append(day.Resolution.ToString(CultureInfo.InvariantCulture)).Append(",\"p\":[")
                .AppendJoin(',', day.Prices.Select(Price.Format)).Append("]}");
        }
        builder.Append("\n}}\n");
        return builder.ToString();
    }

    public static string SerializeIndex(IEnumerable<int> years, DateOnly firstDay, DateOnly lastDay) =>
        $"{{\"schema\":{Schema},\"years\":[{string.Join(',', years.Order())}],\"first_day\":\"{IsoDate(firstDay)}\",\"last_day\":\"{IsoDate(lastDay)}\"}}\n";

    public static string IsoDate(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>
    /// Writes through a temporary file in the same directory followed by a rename.
    /// Returns false, without touching the file, when its bytes are already identical.
    /// </summary>
    public static bool WriteIfChanged(string path, string content)
    {
        var bytes = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(content);
        if (File.Exists(path) && File.ReadAllBytes(path).AsSpan().SequenceEqual(bytes)) return false;

        var dir = Path.GetDirectoryName(Path.GetFullPath(path))!;
        Directory.CreateDirectory(dir);
        var temp = Path.Combine(dir, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temp, path, overwrite: true);
            return true;
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    private static void RequireKeys(JsonElement element, string context, params string[] keys)
    {
        if (element.ValueKind != JsonValueKind.Object)
            throw new StoreFormatException($"{context}: expected an object");
        var names = element.EnumerateObject().Select(property => property.Name).ToList();
        if (names.Count != keys.Length || !keys.All(names.Contains))
            throw new StoreFormatException($"{context}: expected exactly the keys {string.Join(", ", keys)}");
    }

    private static void RequireString(JsonElement root, string key, string expected, string context)
    {
        if (root.GetProperty(key).GetString() != expected)
            throw new StoreFormatException($"{context}: {key} must be \"{expected}\"");
    }

    [GeneratedRegex(@"^(\d{4})\.json$")]
    private static partial Regex YearFilePattern();
}
