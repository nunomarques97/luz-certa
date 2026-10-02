namespace OmiePrices.Tests;

public class PriceStoreTests
{
    private static readonly OmieDay Sample = new(Fixture.Date("2024-01-15"), 60, [-0.2m, 3.50m, 0.00m, 20m]);

    [Fact]
    public void Serializes_one_day_per_line_with_compact_prices()
    {
        var json = PriceStore.SerializeYear(2024, [Sample with { Date = Fixture.Date("2024-01-16") }, Sample]);

        Assert.Equal(
            "{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{\n"
            + "\"2024-01-15\":{\"res\":60,\"p\":[-0.2,3.5,0,20]},\n"
            + "\"2024-01-16\":{\"res\":60,\"p\":[-0.2,3.5,0,20]}\n"
            + "}}\n",
            json);
    }

    [Fact]
    public void Round_trips_through_ReadYear()
    {
        var json = PriceStore.SerializeYear(2024, [Sample]);

        var days = PriceStore.ReadYear(json, 2024);

        Assert.Equal(json, PriceStore.SerializeYear(2024, days));
    }

    [Theory]
    [InlineData("{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{\"2025-01-01\":{\"res\":60,\"p\":[1]}}}")]
    [InlineData("{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{\"2024-01-01\":{\"res\":60,\"p\":[1]},\"2024-01-01\":{\"res\":60,\"p\":[1]}}}")]
    [InlineData("{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{\"2024-01-01\":{\"res\":30,\"p\":[1]}}}")]
    [InlineData("{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{\"2024-01-01\":{\"res\":60,\"p\":[\"1\"]}}}")]
    [InlineData("{\"schema\":2,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{}}")]
    [InlineData("{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"ES\",\"days\":{}}")]
    [InlineData("{\"schema\":1,\"source\":\"OMIE marginalpdbcpt\",\"unit\":\"EUR/MWh\",\"zone\":\"PT\",\"days\":{},\"extra\":1}")]
    [InlineData("{\"schema\":1,")]
    public void ReadYear_rejects_invalid_shapes(string json)
    {
        Assert.Throws<StoreFormatException>(() => PriceStore.ReadYear(json, 2024));
    }

    [Fact]
    public void WriteIfChanged_skips_identical_content_and_leaves_no_temporary_file()
    {
        using var dir = new TempDir();
        var path = dir.File("2024.json");

        Assert.True(PriceStore.WriteIfChanged(path, "first\n"));
        var written = File.GetLastWriteTimeUtc(path);
        Assert.False(PriceStore.WriteIfChanged(path, "first\n"));
        Assert.Equal(written, File.GetLastWriteTimeUtc(path));
        Assert.True(PriceStore.WriteIfChanged(path, "second\n"));

        Assert.Equal("second\n", File.ReadAllText(path));
        Assert.Equal(["2024.json"], Directory.EnumerateFiles(dir.Path).Select(Path.GetFileName));
    }
}
