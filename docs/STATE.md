---
status: v0.1 built and tested; CI green on GitHub; repository public since 2026-10-02; app not hosted
sponsor_action: >-
  On your Windows PC, open PowerShell in the luz-certa\web folder, run "npm ci" and then "npm start",
  open http://localhost:4500, upload your own E-Redes 15-minute file, compare the total shown for your
  current tariff with your bills for the same months, and while doing so note any screen text and the
  name "Luz Certa" you would change; send both notes back.
kill_review:
  date: 2026-11-15
  criterion: >-
    Stop or rethink before the v1 work (30+ offers before January) if the Sponsor's real E-Redes file
    cannot be read, or if the total for the current tariff differs from the real bills for the same
    months by more than 5 % after the items the app lists as not priced.
success_metric: >-
  For the Sponsor's real E-Redes file, the app reads the whole period without errors and its total for
  the current tariff is within 3 % of the real bills for the same months. Usage is not measured: the
  app has no analytics by design.
---

# State

Last updated 2026-10-02. Scope and roadmap: [PRODUCT.md](PRODUCT.md). Tour: [WALKTHROUGH.md](WALKTHROUGH.md).

## What exists

- Angular app in `web/` with three screens (upload, setup with contracted power and current tariff, results) and a sources page ("Fontes e pressupostos"). The E-Redes file is parsed and priced in a Web Worker.
- Parser for the E-Redes Balcão Digital export ([E-REDES-FORMAT.md](E-REDES-FORMAT.md)) and 12 synthetic fixture files in `fixtures/synthetic/`.
- Tariff catalogue in `catalogue/`, version 2026.10.02: 6 fixed and 4 indexed offers, ERSE access tariffs for 4 periods (2024 to 2026), taxes and fees, each with a source URL and verified-on date.
- OMIE price job (.NET 10) in `jobs/omie-prices/`, its daily workflow `.github/workflows/omie-prices.yml`, and OMIE prices for 2024-01-01 to 2026-10-03 in `web/public/data/omie/`.
- README, LICENSE (MIT), CONTRIBUTING, CI workflow `.github/workflows/ci.yml` and the document checker `scripts/check-docs.mjs`.

## Confirmed by evidence

All runs on 2026-10-02 on the development PC (Windows 11, Node 24.14, .NET 10).

| What | Evidence |
| --- | --- |
| Catalogue is valid and `catalogue.json` is current | `npm run catalogue:check`: "OK catalogue 2026.10.02: 6 fixed + 4 indexed offers, 4 TAR periods" |
| Unit tests pass | `npm test`: 28 script tests and 187 unit tests in 15 files passed. Repeated with `TZ=UTC` (as on a CI runner): same result |
| Hand-checked synthetic year within 1 % | `web/src/app/engine/hand-check.spec.ts` (part of `npm test`). Hand and engine totals differ by at most 0.001 % for the three offers in [HAND-CHECK.md](HAND-CHECK.md) |
| Production build | `npm run build`: completed, engine worker as a separate 33 kB chunk |
| End-to-end and privacy tests | `npm run e2e`: 13 Playwright tests passed in Chromium, including `privacy.spec.ts`: no request carries the marker values or the file name, every request is a same-origin GET without a body, the CSP has `connect-src 'self'`, and two negative controls prove the detector catches a deliberate leak and a third-party request |
| OMIE job | `dotnet test jobs/omie-prices/OmiePrices.slnx`: 92 tests passed (offline, recorded files) |
| Screenshots of every screen at 1440 and 390 px | 20 files in [evidence/](evidence/), from `npm run evidence`, which also fails if a screen is wider than the viewport |
| Three design directions | Screenshots and prototypes in [ui/](ui/); the choice is recorded in [DESIGN.md](../DESIGN.md) |
| Document rules | `node scripts/check-docs.mjs` passes; `--self-test` proves each failure is detected (23 cases) |

## Not verified

- **Real E-Redes files.** E-Redes publishes no specification. The parser follows three public open-source readers and an anonymised sample that was re-created, not exported. No real export has been tried. This is the first thing the Sponsor's own file will test.
- **Catalogue values.** 14 points could not be confirmed on a public page and are listed in [catalogue/UNVERIFIED.md](../catalogue/UNVERIFIED.md). The largest: Coopérnico's two published formulas disagree and its system costs have no published value (its result is a minimum), Goldenergy's loss coefficients are not published, fixed prices come from ERSE open data rather than supplier pages, and fees and the social tariff financing for 2024 and 2025 are assumed equal to the current values.
- **Current prices on past consumption.** Fixed offers use today's prices on past consumption, while indexed offers use historical OMIE and TAR. The app shows this as an assumption; real past bills may differ.
- **Daily OMIE workflow.** `ci.yml` runs green on GitHub (run 37056776294, 2026-10-02, after `.gitattributes` kept the synthetic fixtures byte-exact on Linux). The daily OMIE workflow (`omie-prices.yml`, 13:15 UTC) has not run on GitHub yet; the OMIE files so far were fetched by running the job locally. Check its first run and its commit on 2026-10-03.
- **Accessibility and devices.** Screens were checked in desktop Chromium at 1440 and 390 px. No screen reader, real phone, Safari or Firefox test was done.
- **Name and copy.** "Luz Certa" is a working name; name and domain are not checked. All screen text and documents are a draft for the Sponsor.

## Sponsor gates (nothing done)

- Making the repository public: done 2026-10-02.
- Affiliate links.
- A domain and any hosting. There is no deployment in v0.1; the app runs locally.

## Next

v0.2: load-shifting simulation and hourly CO2 intensity. v1 (before January): 30 or more offers with a weekly staleness check, and a shareable result card. See [PRODUCT.md](PRODUCT.md).
