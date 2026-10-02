# Luz Certa

> **Working name.** "Luz Certa" is a provisional name. The name and any domain must be checked before public use.

Upload the 15-minute consumption file you download from E-Redes and see what you would have paid, over the same period, with each electricity tariff in the catalogue: fixed-price offers (simple and bi-hourly) and offers indexed to the OMIE market price. Everything runs in your browser. The file never leaves your device.

The user interface is in European Portuguese. The code and these documents are in English.

## What it does

- Reads the E-Redes Balcão Digital export (`.xlsx`). E-Redes reports average power in kW per quarter-hour, so energy is kWh = kW / 4. The layout the parser expects is described in [docs/E-REDES-FORMAT.md](docs/E-REDES-FORMAT.md).
- Prices every quarter-hour of your real load curve with each offer: fixed prices for fixed offers, historical OMIE prices and ERSE access tariffs (TAR) for indexed offers, plus taxes and fees (VAT, IEC, DGEG fee, audiovisual contribution).
- Shows a ranking by total cost, the difference against your current tariff (picked from the list or typed from your bill), a month-by-month comparison and every assumption behind the numbers, including missing or estimated readings and values that could not be verified.
- The ranking is ordered by cost only. It is never paid or sponsored, and there are no affiliate links.

Version 0.1 has 10 offers (6 fixed, 4 indexed). See [Roadmap](#roadmap) for what comes next.

## Privacy

- The file is read in the browser and parsed and priced in a Web Worker on your device. Nothing is uploaded.
- The app only fetches its own static files from the same origin: the tariff catalogue (`web/public/data/catalogue.json`) and the OMIE prices (`web/public/data/omie/*.json`). These requests carry no consumption data.
- A Content Security Policy (`connect-src 'self'`) blocks requests to any other site. There are no analytics, no third-party scripts and no fonts from other sites.
- An automated test enforces this: [web/e2e/privacy.spec.ts](web/e2e/privacy.spec.ts) uploads a synthetic file with unique marker values, records every request made by the page and its worker, and fails if any request carries a marker value or the file name, is not a same-origin GET, or has a body.
- The repository contains only synthetic consumption files ([fixtures/synthetic/](fixtures/synthetic/)). Real files are blocked by `.gitignore`.

## Run it locally on Windows

Requirements: [Node.js](https://nodejs.org/) 22.18 or later (developed on 24.14) and Git. No Docker or WSL is needed.

In PowerShell:

```powershell
git clone <repository-url> luz-certa
cd luz-certa\web
npm ci
npm start
```

Open http://localhost:4500 and choose your E-Redes file. To get it, sign in to the E-Redes Balcão Digital (https://balcaodigital.e-redes.pt/), open your consumption readings at 15-minute intervals and export them to Excel. Synthetic example files are in [fixtures/synthetic/](fixtures/synthetic/).

The OMIE price job needs the [.NET 10 SDK](https://dotnet.microsoft.com/download) only if you want to run or change it.

## Commands

From `web/`:

| Command | What it does |
| --- | --- |
| `npm ci` | Install dependencies from the lock file |
| `npm start` | Dev server on http://localhost:4500 |
| `npm test` | Type checks, script tests and unit tests (including the hand-checked synthetic year) |
| `npm run build` | Production build into `web/dist/` |
| `npm run e2e` | Playwright behaviour and privacy tests against the production build on port 4510 |
| `npm run evidence` | Screenshots of every screen at 1440 and 390 px into `docs/evidence/` |
| `npm run catalogue:check` | Validate `catalogue/*.yaml` and check that `public/data/catalogue.json` is up to date |
| `npm run catalogue:build` | Validate the catalogue and regenerate `public/data/catalogue.json` |
| `npm run fixtures` | Regenerate the synthetic files in `fixtures/synthetic/` |

Playwright needs a Chromium build. If it is not installed yet, run `npx playwright install chromium` once.

From the repository root:

| Command | What it does |
| --- | --- |
| `dotnet test jobs/omie-prices/OmiePrices.slnx` | OMIE job unit tests (offline) |
| `dotnet run --project jobs/omie-prices/src/OmiePrices -- fetch --data web/public/data/omie` | Download missing OMIE days |
| `dotnet run --project jobs/omie-prices/src/OmiePrices -- verify --data web/public/data/omie` | Check that the price files are complete |
| `node scripts/check-docs.mjs` | Check STATE.md front-matter, WALKTHROUGH.md length and the no em-dash rule (`--self-test` tests the checker) |

Continuous integration (`.github/workflows/ci.yml`) runs the catalogue check, unit tests, build, end-to-end tests, the OMIE job tests and the document checks on every push and pull request. A second workflow (`.github/workflows/omie-prices.yml`) updates the OMIE prices every day.

## Data sources

Only public sources are used. Every offer and tariff in the catalogue carries its source URL and the date it was last verified; the app lists them on its "Fontes e pressupostos" page.

| Data | Source |
| --- | --- |
| Day-ahead market prices for Portugal | OMIE, Operador del Mercado Ibérico de Energía (https://www.omie.es), daily `marginalpdbcpt` files. Prices from 2024-01-01, stored in `web/public/data/omie/`. |
| Access tariffs (TAR), regulated tariff, tariff cycle hours | ERSE, Entidade Reguladora dos Serviços Energéticos (https://www.erse.pt) |
| Fixed-offer prices | ERSE price comparison open data (https://simuladorprecos.erse.pt) |
| Indexed-offer formulas and parameters | The suppliers' public tariff pages and standard information sheets (Coopérnico, EDP Comercial, Goldenergy) |
| VAT rates and thresholds | Código do IVA, Portal das Finanças (https://info.portaldasfinancas.gov.pt) |
| E-Redes file layout | Public open-source readers of the export: [jpedrocr/eredes-omie](https://github.com/jpedrocr/eredes-omie), [tiagofelicia/simulador-tarifarios-eletricidade](https://github.com/tiagofelicia/simulador-tarifarios-eletricidade), [jd164/e-redes-powerscope](https://github.com/jd164/e-redes-powerscope) |

Market data is the property of OMIE; tariff data belongs to ERSE and to each supplier. Values that could not be confirmed on a public page are listed in [catalogue/UNVERIFIED.md](catalogue/UNVERIFIED.md) and shown in the app as assumptions.

Results are an estimate of past costs, not a quote or financial advice. Always check the current conditions with the supplier.

## Roadmap

Scope, roadmap and decisions are in [docs/PRODUCT.md](docs/PRODUCT.md). In short: v0.2 adds a load-shifting simulation and hourly CO2 intensity; v1 aims for 30 or more offers with a weekly staleness check and a shareable result card. Current status: [docs/STATE.md](docs/STATE.md). A short tour: [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). Copyright (c) 2026 Nuno Marques.
