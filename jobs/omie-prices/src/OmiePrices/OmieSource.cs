using System.Net;
using System.Text;

namespace OmiePrices;

public interface IOmieSource
{
    /// <summary>Returns the day file content, or null when OMIE has not published that day (HTTP 404 for every candidate file).</summary>
    Task<string?> GetDayFileAsync(DateOnly day, CancellationToken cancellationToken);
}

public sealed class OmieSourceException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Downloads day files from the public OMIE website. No account or key is involved.
/// OMIE's Portugal series lacks some days (e.g. 2025-03-26), so a 404 falls back to the Iberian file of the same day,
/// whose rows are identical (Portugal price in the fifth column).
/// </summary>
public sealed class HttpOmieSource(HttpClient http, Func<TimeSpan, CancellationToken, Task>? delay = null) : IOmieSource
{
    public const int Attempts = 3;
    private const string DownloadUrl = "https://www.omie.es/es/file-download";
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;

    private static readonly string[] Files = [OmieDayFile.PortugalFile, OmieDayFile.IberianFile];

    public static Uri DayUri(DateOnly day, string file = OmieDayFile.PortugalFile) =>
        new($"{DownloadUrl}?parents={file}&filename={OmieDayFile.FileName(day, file)}");

    public static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("luz-certa-omie-prices/1.0");
        return client;
    }

    public async Task<string?> GetDayFileAsync(DateOnly day, CancellationToken cancellationToken)
    {
        foreach (var file in Files)
        {
            var content = await DownloadAsync(DayUri(day, file), day, cancellationToken);
            if (content is not null) return content;
        }
        return null;
    }

    private async Task<string?> DownloadAsync(Uri uri, DateOnly day, CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (response.StatusCode == HttpStatusCode.NotFound) return null;
                if ((int)response.StatusCode >= 500 && attempt < Attempts)
                {
                    await _delay(Backoff(attempt), cancellationToken);
                    continue;
                }
                if (!response.IsSuccessStatusCode)
                    throw new OmieSourceException($"{uri}: HTTP {(int)response.StatusCode}");
                return await ReadLimitedAsync(response.Content, day, cancellationToken);
            }
            catch (Exception ex) when (IsTransient(ex, cancellationToken) && attempt < Attempts)
            {
                await _delay(Backoff(attempt), cancellationToken);
            }
            catch (Exception ex) when (IsTransient(ex, cancellationToken))
            {
                throw new OmieSourceException($"{uri}: {ex.Message}", ex);
            }
        }
    }

    private static bool IsTransient(Exception ex, CancellationToken cancellationToken) =>
        ex is HttpRequestException || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested);

    private static TimeSpan Backoff(int attempt) => TimeSpan.FromSeconds(5 * attempt);

    private static async Task<string> ReadLimitedAsync(HttpContent content, DateOnly day, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        var buffer = new byte[OmieDayFile.MaxLength + 1];
        var length = 0;
        int read;
        while (length < buffer.Length && (read = await stream.ReadAsync(buffer.AsMemory(length), cancellationToken)) > 0)
            length += read;
        if (length > OmieDayFile.MaxLength)
            throw new OmieFormatException($"{OmieDayFile.FileName(day)}: response is larger than {OmieDayFile.MaxLength} bytes");
        return Encoding.UTF8.GetString(buffer, 0, length);
    }
}
