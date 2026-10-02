# Product brief

Sponsor brief, 2026-10-02 (verbatim). Source of truth for scope, roadmap and Sponsor gates.

```text
PROJECT: Luz Certa (working name; check name and domain before any public use), open-source code (MIT).
GOAL: upload your E-Redes 15-minute consumption file and see what you would have paid over the same period with each tariff, including OMIE-indexed ones, plus the saving from shifting load to cheaper hours. Everything runs in the browser; the file never leaves the device.
WHY: ERSE's simulator compares offers using the annual consumption the user types; nobody back-tests offers on the real load curve; people struggle to read the E-Redes file (values are average kW per quarter-hour, so kWh = value / 4). ERSE recommends comparing offers in January.
v0.1
- Angular SPA (ports 45xx, European Portuguese UI); parsing and calculation in a Web Worker (TypeScript).
- Parser for the E-Redes Balcão Digital export, built from the documented format. Synthetic sample files only; never commit real consumption data.
- Tariff catalogue as versioned YAML: 6 fixed offers (simple and bi-hourly) and 4 indexed offers with their published formula (e.g. Coopérnico: (OMIE + k) x (1 + FP) + TAR), each with source URL and 'verified on' date; ERSE access tariffs (TAR) for the period. Only public sources.
- OMIE historical prices fetched by a .NET console job in a daily GitHub Actions cron and committed as compact JSON.
- Result page: ranking by annual cost, difference against the current tariff, monthly breakdown, every assumption visible. Never a paid or sponsored ranking.
- UI: the design phase produces 3 directions, picks one, saves screenshots of all three in docs/ui/; Playwright screenshots of every screen at 1440 and 390 px in docs/evidence/.
- Open-source quality: README, LICENSE (MIT), CONTRIBUTING.md, CI (build, tests).
- 0 EUR, no new accounts, no secrets in the repo, Windows-native. Copy is a draft for the Sponsor: no em-dashes, nothing about how it was built.
ACCEPTANCE: a hand-checked synthetic year matches within 1 %; a test proves no network request carries consumption data; screenshots; docs/STATE.md with YAML front-matter (status, sponsor_action, kill_review, success_metric); docs/WALKTHROUGH.md (max 2 pages).
ROADMAP: v0.2 = load-shifting simulation and hourly CO2 intensity; v1 (before January) = 30+ offers with a weekly staleness check, shareable result card, affiliate links only if the Sponsor approves.
SPONSOR GATES: making the repo public; affiliates; optional domain.
```

## Sponsor decisions

- 2026-10-02: repository created PRIVATE. Making it public is the Sponsor's decision only.
- 2026-10-02: no Linear; roadmap lives here, current state in docs/STATE.md.
- 2026-10-02: affiliate links and an optional domain are Sponsor gates; none in v0.1.
- 2026-10-02: no system software is installed for this project; the machine stays on Node 24.14.0. Angular 21 LTS (the newest major that supports Node 24.14) is the accepted Angular version for v0.1. Upgrading to Angular 22 needs Node 24.15+ and is deferred until the Sponsor upgrades Node.
