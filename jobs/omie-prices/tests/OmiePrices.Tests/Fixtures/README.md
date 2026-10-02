# Synthetic OMIE fixtures

Files in the layout of OMIE `marginalpdbcpt_YYYYMMDD.1` (CRLF, semicolons, dot decimal, `*` end line) with synthetic prices.
Every fourth period has a different Spain price, so tests can tell the Portugal column apart.

- `marginalpdbcpt_*.1`: valid days covering hourly (2024-01-15, 2024-01-16, 2025-09-30), the hourly DST short and long days (2024-03-31, 2024-10-27), the first quarter-hour day (2025-10-01) and the quarter-hour DST long and short days (2025-10-26, 2026-03-29).
- `malformed/`: truncated, missing end marker, missing period, comma decimal, non-numeric or out-of-range price, wrong date, period order, an HTML page, and period counts that do not match the day's resolution or length.

`.gitattributes` keeps the CRLF bytes exactly as written.
