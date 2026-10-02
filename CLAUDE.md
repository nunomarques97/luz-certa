# Luz Certa

Open-source (MIT) browser tool for Portuguese households: upload the E-Redes 15-minute consumption file and see what each electricity tariff, fixed or OMIE-indexed, would have cost on that real load curve. The file never leaves the device. Product brief, scope and roadmap: [docs/PRODUCT.md](docs/PRODUCT.md).

## Stack & essentials
- Web: Angular SPA (dev server on a 45xx port), European Portuguese UI; parsing and calculation in a Web Worker (TypeScript).
- OMIE price job: .NET 10 console app, run by a daily GitHub Actions cron; commits compact JSON to the repo.
- Tariff catalogue: versioned YAML with source URL and "verified on" date per offer.
- Local development is Windows-native: no Docker, no WSL2.
- Commands: defined by the first implementation; record them here once they exist.

## Invariants
- The repository stays PRIVATE. Making it public is the Sponsor's decision only.
- Consumption data never leaves the device: no upload, no analytics carrying it, no third-party request with it. A test enforces this.
- Never commit real consumption data. Only synthetic files under `fixtures/synthetic/` (any other `*.xlsx`/`*.xls` is git-ignored).
- Ranking is never paid or sponsored. Affiliate links only with Sponsor approval.
- Only public tariff sources, each with source URL and verified-on date.
- 0 EUR, no new accounts, no secrets in the repo.
- Source code, identifiers, comments and logs in English; UI copy in European Portuguese. Public copy: no em-dashes, nothing about how it was built.

## Conventions
- `.gitignore` excludes any file name containing "token" or "secret" (credential rule). Do not name source files that way (for design tokens use e.g. `theme.css`, `design-vars.scss`).
- E-Redes values are average kW per quarter-hour: kWh = value / 4.

## Verification
- Done requires evidence: test/build output, the hand-checked synthetic year (within 1 %), Playwright screenshots of every screen at 1440 and 390 px in docs/evidence/.
- Reports separate what was confirmed by evidence from what could not be verified.

## Where things live
- Product brief, scope, roadmap, Sponsor gates: `docs/PRODUCT.md`
- Current state: `docs/STATE.md`
- Walkthrough: `docs/WALKTHROUGH.md`
- Design reference: `DESIGN.md` (created by the design phase) and `docs/ui/`
- Work tracking: no Linear (small single-maintainer project); roadmap lives in `docs/PRODUCT.md`, state in `docs/STATE.md`
- Project skills/hooks: n/a
- Tooling configured here: n/a (FORJA Core run supplies design/frontend methods) — catalog: `C:\Users\User\Desktop\PLAYBOOK\TOOLING.md`

<!-- forja-core:begin -->
## FORJA core
New FORJA tasks use Core. The conversation agent prepares the goal, starts the controller and reports its result; it does not act as Lead or manually dispatch the legacy crew.
Resolve `<forja>` from the caller-provided installation, `FORJA_ROOT`, or an existing FORJA hook path in `.claude/settings.json`. If unavailable, ask for the installation path; do not guess or install another copy.
Read `<forja>/docs/CORE.md` and `<forja>/docs/CORE-RUNBOOK.md`. From this project: `node "<forja>/bin/forja.mjs" start --goal "..." --provider claude|codex|kilo`. Supply the explicitly selected profile with `--config`; installing or updating FORJA does not select models.
The controller owns planning, development, checks and independent review. Workers read only the phase and applicable domain methods supplied in `specialist_context`. Do not load `forja-lead` or other legacy crew skills for Core work.
Core state and usage live in `.forja/`. Inspect existing changes before starting; preserve them and use `--allow-dirty` only when work on that snapshot is authorized. Git delivery requires explicit configuration and the controller delivery contract.
Preparation does not start a run. Never silently resume or replace an active Core or legacy run. Stop existing executors before an explicitly authorized handover; preserve their state and unfinished work.
Legacy `runner` and `run start` are compatibility commands only when explicitly requested. Their state remains in `docs/forja/`; read legacy methods as files for that workflow. Restart the conversation after migration to discard previously loaded legacy instructions.
<!-- forja-core:end -->
