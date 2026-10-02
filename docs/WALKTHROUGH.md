# Walkthrough

A short tour of Luz Certa v0.1, using the synthetic year file `fixtures/synthetic/synthetic-year-2025.xlsx`. Every screenshot was taken by `npm run evidence` at 1440 px (desktop) and 390 px (phone). Current status and open points: [STATE.md](STATE.md).

## 1. Choose the file

The first screen explains which file to download from E-Redes and states, in the header and next to the drop area, that the file does not leave the device. The user drops or picks the `.xlsx` export.

- [Upload, 1440 px](evidence/upload-default-1440.png), [390 px](evidence/upload-default-390.png)

If the file cannot be read (wrong format, missing column, hourly instead of 15-minute readings, impossible date), the error says what is wrong and how to fix it, and another file can be chosen at once.

- [Upload error, 1440 px](evidence/upload-error-1440.png), [390 px](evidence/upload-error-390.png)

## 2. Power and current tariff

After reading the file, the app asks for the contracted power (kVA) and the current tariff: either picked from the list or entered as the prices on the bill. A box for large families (five or more people) raises the energy allowance with reduced VAT, as on the bill.

- [Setup, 1440 px](evidence/setup-default-1440.png), [390 px](evidence/setup-default-390.png)

## 3. Calculating

Parsing and pricing run in a Web Worker, so the page stays responsive. The worker loads only the app's own static data: the catalogue, the OMIE index and the OMIE price file for each year in the period.

- [Processing, 1440 px](evidence/processing-default-1440.png), [390 px](evidence/processing-default-390.png)

## 4. Results

The top of the results answers the question directly: what the cheapest offer would have cost over the period in the file, how much less (or more) than the current tariff, and where the current tariff ranks. A strip above shows the period, total kWh, power and file name, with links to change the power or tariff or to choose another file. Data warnings (here, 66 estimated readings) appear in a banner.

- [Top of results, 1440 px](evidence/results-top-1440.png), [390 px](evidence/results-top-390.png)

The ranking lists all 10 offers from cheapest to dearest, ordered by cost only. Each row shows the total with VAT and fees, the difference against the current tariff and a bar that grows left (cheaper) or right (dearer) from the current tariff's line. Offers that leave out a cost with no published value carry a "valor mínimo" label, and the best offer without that caveat is named too.

- [Ranking, 1440 px](evidence/results-ranking-1440.png), [390 px](evidence/results-ranking-390.png)

The month-by-month section compares the current tariff with any chosen offer, as a chart and as a table with kWh, both costs and the difference.

- [Monthly breakdown, 1440 px](evidence/results-monthly-1440.png), [390 px](evidence/results-monthly-390.png)

Every assumption is listed: one billing period per calendar month, current fixed prices applied to past consumption, historical OMIE and access tariffs for indexed offers, the Spain to Lisbon time shift, VAT rules, fees, cycle hours, and any value that could not be verified.

- [Assumptions, 1440 px](evidence/results-assumptions-1440.png), [390 px](evidence/results-assumptions-390.png)

## 5. Sources

The "Fontes e pressupostos" page lists each data source and each offer with its public source link and the date it was verified.

- [Sources, 1440 px](evidence/sources-default-1440.png), [390 px](evidence/sources-default-390.png)
- [Offers and their sources, 1440 px](evidence/sources-offers-1440.png), [390 px](evidence/sources-offers-390.png)

## How we know the numbers are right

- **Hand check.** [HAND-CHECK.md](HAND-CHECK.md) works out, with calculator arithmetic, the yearly cost of three offers (one fixed simple, one fixed bi-hourly, one OMIE-indexed) for the synthetic year. The engine matches each total within 0.001 %; the test requires 1 %.
- **Privacy.** A browser test uploads the synthetic year, which carries unique marker values, records every request of the page and its worker, and fails if any request carries a marker or the file name or goes to another site. Two negative controls prove the detector catches a deliberate leak.
- **Catalogue.** `npm run catalogue:check` validates every offer, tariff and tax, including its source URL and verified-on date. Values that could not be confirmed are listed in [catalogue/UNVERIFIED.md](../catalogue/UNVERIFIED.md) and shown in the app.

## What it does not do yet

- No load-shifting simulation or CO2 view (v0.2).
- 10 offers only; v1 aims for 30 or more with a weekly staleness check.
- Not hosted: the app runs on your own computer (`npm start` in `web/`, then http://localhost:4500).
