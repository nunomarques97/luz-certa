using System.Net;

namespace OmiePrices.Tests;

public class HttpOmieSourceTests
{
    private static readonly DateOnly Day = Fixture.Date("2025-10-01");

    private sealed class ScriptedHandler(params Func<HttpRequestMessage, HttpResponseMessage>[] responses) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return Task.FromResult(responses[Math.Min(Requests.Count, responses.Length) - 1](request));
        }
    }

    private static HttpResponseMessage Status(HttpStatusCode code, string body = "") => new(code) { Content = new StringContent(body) };

    private static (HttpOmieSource Source, ScriptedHandler Handler, List<TimeSpan> Delays) Create(params Func<HttpRequestMessage, HttpResponseMessage>[] responses)
    {
        var handler = new ScriptedHandler(responses);
        var delays = new List<TimeSpan>();
        var source = new HttpOmieSource(new HttpClient(handler), (delay, _) =>
        {
            delays.Add(delay);
            return Task.CompletedTask;
        });
        return (source, handler, delays);
    }

    [Fact]
    public async Task Downloads_the_public_day_file_without_credentials()
    {
        var content = Fixture.Day(Day);
        var (source, handler, _) = Create(_ => Status(HttpStatusCode.OK, content));

        Assert.Equal(content, await source.GetDayFileAsync(Day, CancellationToken.None));

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("https://www.omie.es/es/file-download?parents=marginalpdbcpt&filename=marginalpdbcpt_20251001.1", request.RequestUri!.ToString());
        Assert.Null(request.Headers.Authorization);
        Assert.Null(request.Content);
    }

    [Fact]
    public async Task Returns_null_for_404_not_yet_published()
    {
        var (source, handler, delays) = Create(_ => Status(HttpStatusCode.NotFound, "<html>not found</html>"));

        Assert.Null(await source.GetDayFileAsync(Day, CancellationToken.None));
        Assert.Equal(
            ["filename=marginalpdbcpt_20251001.1", "filename=marginalpdbc_20251001.1"],
            handler.Requests.Select(request => request.RequestUri!.Query.Split('&')[1]));
        Assert.Empty(delays);
    }

    [Fact]
    public async Task Falls_back_to_the_Iberian_file_when_the_Portugal_file_is_missing()
    {
        var iberian = Fixture.Day(Day).Replace("MARGINALPDBCPT;", "MARGINALPDBC;");
        var (source, handler, _) = Create(
            _ => Status(HttpStatusCode.NotFound),
            _ => Status(HttpStatusCode.OK, iberian));

        var content = await source.GetDayFileAsync(Day, CancellationToken.None);

        Assert.Equal(iberian, content);
        Assert.Equal(
            "https://www.omie.es/es/file-download?parents=marginalpdbc&filename=marginalpdbc_20251001.1",
            handler.Requests[1].RequestUri!.ToString());
        Assert.Equal(OmieDayFile.Parse(Fixture.Day(Day), Day).Prices, OmieDayFile.Parse(content!, Day).Prices);
    }

    [Fact]
    public async Task Retries_server_errors_then_succeeds()
    {
        var (source, handler, delays) = Create(
            _ => Status(HttpStatusCode.ServiceUnavailable),
            _ => throw new HttpRequestException("connection reset"),
            _ => Status(HttpStatusCode.OK, "ok"));

        Assert.Equal("ok", await source.GetDayFileAsync(Day, CancellationToken.None));
        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal(2, delays.Count);
    }

    [Fact]
    public async Task Fails_after_repeated_server_errors()
    {
        var (source, handler, _) = Create(_ => Status(HttpStatusCode.InternalServerError));

        await Assert.ThrowsAsync<OmieSourceException>(() => source.GetDayFileAsync(Day, CancellationToken.None));
        Assert.Equal(HttpOmieSource.Attempts, handler.Requests.Count);
    }

    [Fact]
    public async Task Fails_without_retry_on_other_client_errors()
    {
        var (source, handler, _) = Create(_ => Status(HttpStatusCode.Forbidden));

        await Assert.ThrowsAsync<OmieSourceException>(() => source.GetDayFileAsync(Day, CancellationToken.None));
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task Rejects_an_oversized_response()
    {
        var (source, _, _) = Create(_ => Status(HttpStatusCode.OK, new string('x', OmieDayFile.MaxLength + 1)));

        await Assert.ThrowsAsync<OmieFormatException>(() => source.GetDayFileAsync(Day, CancellationToken.None));
    }
}
