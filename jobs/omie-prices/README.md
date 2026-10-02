# OMIE price job

.NET 10 console app that keeps `web/public/data/omie/` up to date with the Portuguese day-ahead marginal prices published by OMIE.
A GitHub Actions workflow (`.github/workflows/omie-prices.yml`) runs it every day at 13:15 UTC and commits changed files.

| Command (from the repository root) | What it does |
| --- | --- |
| `dotnet test jobs/omie-prices/OmiePrices.slnx` | Unit tests (offline, recorded synthetic OMIE files) |
| `dotnet run --project jobs/omie-prices/src/OmiePrices -- fetch --data web/public/data/omie` | Download every missing day from 2024-01-01 up to the latest published day |
| `dotnet run --project jobs/omie-prices/src/OmiePrices -- verify --data web/public/data/omie` | Offline completeness and shape check; non-zero exit on failure |

Both commands accept `--from yyyy-MM-dd` (default `2024-01-01`).

## Source

Public OMIE day files `marginalpdbcpt_YYYYMMDD.1` from
`https://www.omie.es/es/file-download?parents=marginalpdbcpt&filename=marginalpdbcpt_YYYYMMDD.1`.
No account or key. Each row is `year;month;day;period;Portugal price;Spain price;` (EUR/MWh, dot decimal), closed by a `*` line.
OMIE's Portugal series lacks a few days (2025-03-26 at the time of writing). When the Portugal file answers HTTP 404 the job reads the Iberian file
`marginalpdbc_YYYYMMDD.1` for the same day, which has identical rows (Portugal price in the fifth column).
Periods are hourly (24, 23 or 25 per day) until 2025-09-30 and quarter-hourly (96, 92 or 100) from 2025-10-01.

## Output

`<year>.json`, one market day per line:

```json
{"schema":1,"source":"OMIE marginalpdbcpt","unit":"EUR/MWh","zone":"PT","days":{
"2025-10-01":{"res":15,"p":[118.28,117.8]}
}}
```

Days are OMIE market days in Spanish time (CET/CEST) and `p` keeps the published period order. Converting to Lisbon time is the web engine's job.
`index.json` lists the years and the first and last day.

## Behaviour

- A day that OMIE answers with HTTP 404 after today (Spanish date) is "not available yet" and ends the run normally. A 404 for an earlier day is an error.
- Every download is validated (header, end marker, date, period count for the day and resolution, numeric prices) before anything is written. One bad file aborts the run and leaves the existing JSON untouched.
- Files are written through a temporary file and a rename, and only when their bytes change, so a rerun without new data changes nothing.
