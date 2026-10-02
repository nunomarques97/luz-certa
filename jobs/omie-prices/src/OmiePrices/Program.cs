using OmiePrices;

using var http = HttpOmieSource.CreateClient();
return await Cli.RunAsync(args, () => new HttpOmieSource(http), TimeProvider.System, Console.Out, Console.Error);
