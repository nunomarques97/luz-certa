using System.Globalization;

namespace OmiePrices.Tests;

internal static class Fixture
{
    public static string Path(string name) => System.IO.Path.Combine(AppContext.BaseDirectory, "Fixtures", name);

    public static string Read(string name) => File.ReadAllText(Path(name));

    public static string Day(DateOnly day) => Read(OmieDayFile.FileName(day));

    public static DateOnly Date(string iso) => DateOnly.ParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}

/// <summary>Serves recorded fixture files; any day without content answers like OMIE's HTTP 404.</summary>
internal sealed class FakeOmieSource : IOmieSource
{
    public Dictionary<DateOnly, string> Files { get; } = [];
    public List<DateOnly> Requests { get; } = [];

    public FakeOmieSource WithDays(params string[] isoDays)
    {
        foreach (var iso in isoDays)
        {
            var day = Fixture.Date(iso);
            Files[day] = Fixture.Day(day);
        }
        return this;
    }

    public Task<string?> GetDayFileAsync(DateOnly day, CancellationToken cancellationToken)
    {
        Requests.Add(day);
        return Task.FromResult(Files.TryGetValue(day, out var content) ? content : null);
    }
}

internal sealed class FixedClock(DateTimeOffset now) : TimeProvider
{
    /// <summary>Noon in Spain on the given day, in winter or summer time.</summary>
    public static FixedClock MadridNoon(string isoDay) =>
        new(new DateTimeOffset(Fixture.Date(isoDay).ToDateTime(new TimeOnly(10, 0)), TimeSpan.Zero));

    public override DateTimeOffset GetUtcNow() => now;
}

internal sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "omie-tests-" + Guid.NewGuid().ToString("N"));

    public TempDir() => Directory.CreateDirectory(Path);

    public string File(string name) => System.IO.Path.Combine(Path, name);

    /// <summary>File name to (bytes, last write time) for every file in the directory.</summary>
    public Dictionary<string, (byte[] Bytes, DateTime Written)> Snapshot() =>
        Directory.EnumerateFiles(Path).ToDictionary(
            file => System.IO.Path.GetFileName(file),
            file => (System.IO.File.ReadAllBytes(file), System.IO.File.GetLastWriteTimeUtc(file)));

    public void Dispose()
    {
        if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
    }
}
