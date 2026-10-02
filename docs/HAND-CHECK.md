# Hand check: synthetic year 2025

Calculator-level arithmetic for three offers on `fixtures/synthetic/synthetic-year-2025.xlsx`, so the cost engine (`web/src/app/engine/cost-engine.ts`) can be checked against numbers a person can redo with a calculator. The test `web/src/app/engine/hand-check.spec.ts` runs the same file through the parser and the engine and requires each engine total to be within 1 % of the hand total below. Its constants must match this document.

## Inputs

- Consumption: the synthetic year file, 2025-01-01 00:00 to 2026-01-01 00:00 Lisbon time, 365 days, 35 040 quarter-hours, no gaps, 66 readings marked as estimated (used as they are).
- Catalogue: `catalogue/` version 2026.10.02 (built into `web/public/data/catalogue.json`).
- Contracted power 6.9 kVA, not a large family.
- Offers: EDP Comercial "Eletricidade" (fixed, simple), EZU Energia "Tarifa EZU Premium" (fixed, bi-hourly, daily cycle) and Coopérnico "ÚNICO" (OMIE-indexed, simple).
- OMIE prices for the indexed offer: the synthetic fixture defined below, not the real market data.

## Aggregates from the file

Sums of the parsed readings (kWh = kW / 4), grouped by the Lisbon calendar month and by the Lisbon start time of each quarter-hour. "Vazio" is the ERSE daily cycle: 22:00 to 08:00 on every day, in Portugal legal time. The test recomputes the year totals from the parser output.

| | kWh |
| --- | --- |
| Total | 3 949.38750 |
| Vazio (22:00 to 08:00) | 1 131.23725 |
| Fora de vazio | 2 818.15025 |

## Terms shared by the three offers

Fees (`catalogue/taxes.yaml`), applied to every offer:

| Fee | Arithmetic | EUR | VAT rate | VAT |
| --- | --- | --- | --- | --- |
| IEC | 0.001 x 3 949.3875 kWh | 3.9494 | 23 % | 0.9084 |
| DGEG | 0.07 x 12 months | 0.8400 | 23 % | 0.1932 |
| Audiovisual contribution | 0.09363 x 365 days | 34.1750 | 6 % | 2.0505 |
| Total | | 38.9643 | | 3.1521 |

VAT rules at 6.9 kVA:

- Power term: 23 %. The 6 % rate on the TAR part applies only up to 3.45 kVA.
- Energy: 6 % on up to 200 kWh per 30 days (contracted power up to 6.9 kVA, from 2025-01-01), pro rata by days in each month: allowance = 200 x days / 30. Every month uses more than its allowance (the lowest month, July, has 220.70 kWh against 206.67), so the reduced-rate part of a month is its allowance times that month's average energy price. Over the year the allowance is 200 x 365 / 30 = 2 433.3333 kWh. The rest of the energy pays 23 %.

## Offer 1: EDP Comercial Eletricidade (fixed, simple)

Catalogue prices at 6.9 kVA, VAT excluded: power 0.5780 EUR/day, energy 0.1671 EUR/kWh. The price is the same in every month, so the reduced-rate base is 2 433.3333 x 0.1671.

| Line | Arithmetic | EUR |
| --- | --- | --- |
| Energy | 3 949.3875 x 0.1671 | 659.9427 |
| Power | 365 x 0.5780 | 210.9700 |
| Fees | see above | 38.9643 |
| VAT energy, 6 % part | 0.06 x (2 433.3333 x 0.1671 = 406.6100) | 24.3966 |
| VAT energy, 23 % part | 0.23 x (659.9427 - 406.6100 = 253.3327) | 58.2665 |
| VAT power | 0.23 x 210.9700 | 48.5231 |
| VAT fees | see above | 3.1521 |
| **Total** | | **1 044.2153** |

Hand total 1 044.22 EUR. Engine 1 044.23 EUR (deviation 0.001 %).

## Offer 2: EZU Energia Tarifa EZU Premium (fixed, bi-hourly, daily cycle)

Catalogue prices at 6.9 kVA, VAT excluded: power 0.4692 EUR/day, vazio 0.1258 EUR/kWh, fora de vazio 0.1935 EUR/kWh.

Energy: 1 131.23725 x 0.1258 = 142.3096, plus 2 818.15025 x 0.1935 = 545.3121, total 687.6217.

The reduced-rate base depends on each month's mix of vazio and fora de vazio. Average price of a month = (vazio kWh x 0.1258 + fora de vazio kWh x 0.1935) / kWh; reduced base = allowance x average price:

| Month | Days | Allowance kWh | kWh | Vazio kWh | Fora de vazio kWh | Average EUR/kWh | Reduced base EUR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2025-01 | 31 | 206.6667 | 442.1638 | 126.6325 | 315.5312 | 0.174111 | 35.9830 |
| 2025-02 | 28 | 186.6667 | 388.9597 | 110.8050 | 278.1547 | 0.174214 | 32.5199 |
| 2025-03 | 31 | 206.6667 | 395.0163 | 112.1370 | 282.8792 | 0.174281 | 36.0181 |
| 2025-04 | 30 | 200.0000 | 328.1278 | 95.2207 | 232.9070 | 0.173854 | 34.7708 |
| 2025-05 | 31 | 206.6667 | 283.1250 | 82.9692 | 200.1557 | 0.173661 | 35.8899 |
| 2025-06 | 30 | 200.0000 | 239.8652 | 64.5872 | 175.2780 | 0.175271 | 35.0542 |
| 2025-07 | 31 | 206.6667 | 220.7000 | 64.7657 | 155.9343 | 0.173633 | 35.8842 |
| 2025-08 | 31 | 206.6667 | 239.9873 | 70.3265 | 169.6608 | 0.173661 | 35.8899 |
| 2025-09 | 30 | 200.0000 | 269.5592 | 76.2850 | 193.2742 | 0.174341 | 34.8682 |
| 2025-10 | 31 | 206.6667 | 334.9967 | 97.6923 | 237.3045 | 0.173757 | 35.9098 |
| 2025-11 | 30 | 200.0000 | 378.0988 | 104.6328 | 273.4660 | 0.174765 | 34.9530 |
| 2025-12 | 31 | 206.6667 | 428.7877 | 125.1832 | 303.6045 | 0.173735 | 35.9053 |
| Year | 365 | 2 433.3333 | 3 949.3875 | 1 131.2373 | 2 818.1503 | | 423.6463 |

| Line | Arithmetic | EUR |
| --- | --- | --- |
| Energy | see above | 687.6217 |
| Power | 365 x 0.4692 | 171.2580 |
| Fees | see above | 38.9643 |
| VAT energy, 6 % part | 0.06 x 423.6463 | 25.4188 |
| VAT energy, 23 % part | 0.23 x (687.6217 - 423.6463 = 263.9754) | 60.7143 |
| VAT power | 0.23 x 171.2580 | 39.3893 |
| VAT fees | see above | 3.1521 |
| **Total** | | **1 026.5186** |

Hand total 1 026.52 EUR. Engine 1 026.53 EUR (deviation 0.001 %).

## Offer 3: Coopérnico ÚNICO (OMIE-indexed, simple)

### Synthetic OMIE fixture

Every OMIE market period of the market days 2025-01-01 to 2026-01-01 gets a price from its start time in Spanish time (CET/CEST):

- 50 EUR/MWh when the period starts at 23:00 or later, or before 09:00;
- 110 EUR/MWh otherwise.

Periods are hourly up to market day 2025-09-30 and quarter-hourly from 2025-10-01, with 23 or 25 hours (92 or 100 quarter-hours) on the clock-change days, like the published data. The test builds this fixture from the time zone database (`Europe/Madrid`), independently of the engine's own Spanish-time mapping.

Spanish time is Lisbon time plus one hour, so the 50 EUR/MWh periods are exactly Lisbon 22:00 to 08:00, the daily-cycle vazio hours above. The same kWh split therefore applies. If the engine did not shift by one hour, a different set of quarter-hours would get the low price.

### Arithmetic

Catalogue formula: energy per kWh = (OMIE + k) x (1 + FP) / 1000 + TAR energy + social tariff financing, with k = 9 EUR/MWh, FP = 0.15, TAR energy for a simple tariff in 2025 = 0.0600 EUR/kWh, social tariff financing 0.002067 EUR/kWh. Power 0.3653 EUR/day at 6.9 kVA (current price, applied unchanged).

- Low price: (50 + 9) x 1.15 / 1000 + 0.0600 + 0.002067 = 0.129917 EUR/kWh
- High price: (110 + 9) x 1.15 / 1000 + 0.0600 + 0.002067 = 0.198917 EUR/kWh

Energy: 1 131.23725 x 0.129917 = 146.9669, plus 2 818.15025 x 0.198917 = 560.5780, total 707.5449.

Reduced-rate base, using the monthly kWh split from the table in offer 2 (average price of a month = (vazio kWh x 0.129917 + fora de vazio kWh x 0.198917) / kWh):

| Month | Allowance kWh | Average EUR/kWh | Reduced base EUR |
| --- | --- | --- | --- |
| 2025-01 | 206.6667 | 0.179156 | 37.0256 |
| 2025-02 | 186.6667 | 0.179261 | 33.4620 |
| 2025-03 | 206.6667 | 0.179329 | 37.0614 |
| 2025-04 | 200.0000 | 0.178894 | 35.7787 |
| 2025-05 | 206.6667 | 0.178697 | 36.9306 |
| 2025-06 | 200.0000 | 0.180338 | 36.0675 |
| 2025-07 | 206.6667 | 0.178669 | 36.9248 |
| 2025-08 | 206.6667 | 0.178697 | 36.9307 |
| 2025-09 | 200.0000 | 0.179390 | 35.8780 |
| 2025-10 | 206.6667 | 0.178795 | 36.9510 |
| 2025-11 | 200.0000 | 0.179822 | 35.9645 |
| 2025-12 | 206.6667 | 0.178773 | 36.9464 |
| Year | 2 433.3333 | | 435.9212 |

| Line | Arithmetic | EUR |
| --- | --- | --- |
| Energy | see above | 707.5449 |
| Power | 365 x 0.3653 | 133.3345 |
| Fees | see above | 38.9643 |
| VAT energy, 6 % part | 0.06 x 435.9212 | 26.1553 |
| VAT energy, 23 % part | 0.23 x (707.5449 - 435.9212 = 271.6237) | 62.4735 |
| VAT power | 0.23 x 133.3345 | 30.6669 |
| VAT fees | see above | 3.1521 |
| **Total** | | **1 002.2915** |

Hand total 1 002.29 EUR. Engine 1 002.29 EUR (deviation below 0.001 %). Like the engine, this leaves out Coopérnico's unpublished system costs (catalogue/UNVERIFIED.md, U2).

## Summary

| Offer | Hand (EUR) | Engine (EUR) | Deviation |
| --- | --- | --- | --- |
| EDP Comercial Eletricidade | 1 044.22 | 1 044.23 | 0.001 % |
| EZU Energia Tarifa EZU Premium | 1 026.52 | 1 026.53 | 0.001 % |
| Coopérnico ÚNICO (synthetic OMIE) | 1 002.29 | 1 002.29 | < 0.001 % |

The engine rounds each month to cents and adds the months, which explains the one-cent differences.

## What this does not check

- Real OMIE prices: the indexed offer uses the synthetic fixture. The mapping of real market periods to Lisbon quarter-hours is covered by `web/src/app/engine/omie-time.spec.ts`.
- Other contracted powers (the 6 % rate on the TAR power part up to 3.45 kVA is covered by `cost-engine.spec.ts`), years before 2025 and the other seven offers.
- Whether the catalogue values themselves are right: see `catalogue/UNVERIFIED.md`.
