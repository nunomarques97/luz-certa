# Values that could not be verified on a public page

Checked on 2026-10-02. Each entry has an id that catalogue entries reference in their `unverified` list; `catalogue:check` fails if a referenced id is missing here. Nothing listed here was filled in with an invented value: where a number is not published, the catalogue leaves it `null` or omits it, and the engine must show the gap as an assumption.

## U1 Coopérnico formula: two published forms disagree

The Coopérnico tariff page and its FIN (2026-10-01) state the energy price as `OMIE x (1 + FP) + k`, but the worked example on the same page computes `((OMIE + k) x 1,16) + TAR`. The catalogue follows the brief and the worked example: `(OMIE + k) x (1 + FP) + TAR`, with `k_eur_mwh: 9`. The two forms differ by `k x FP`, about 1.35 EUR/MWh with FP = 15 %.

## U2 Coopérnico system costs are not published as a number

The page lists "CS - Custos de Sistema (valor mensal variável, EUR/kWh)" with the loss factor applied, but publishes no value. The catalogue lists it under `unpriced_components` and does not price it, so Coopérnico results understate the bill by this amount.

## U3 Coopérnico loss factor and power price over time

FP is the ERSE loss profile; the page gives 15 % "como valor médio indicativo" while the worked example uses 1,16. The catalogue uses 0.15 for every period. The power prices come from the ERSE price list of 2026-10-02; whether past power prices differed is not published, so the current ones are applied to past periods.

## U4 EDP hourly indexed offer: quarter-hourly loss profile not in the catalogue

The EDP FIN applies "Perdas i" from the ERSE quarter-hourly loss profiles. The catalogue does not include those profiles and uses 16.4 %, the average EDP publishes for its average-price variant in the same FIN. Results for this offer are an approximation.

## U5 Goldenergy indexed offer: loss coefficients not published

The Goldenergy FIN says "Perdas = Coeficientes (%) tabelados pela Goldenergy" and publishes no table. `loss_factor.value` is `null`. The engine must not invent a value; it has to report this offer as not computable or show the assumption it uses.

## U6 Goldenergy indexed offer: power price basis and billing period

The ERSE price list shows power prices equal to 0.125 EUR/day plus the 2026 TAR power term at every contracted power, but the FIN does not say the price is defined that way. The catalogue treats the power prices as fixed current prices. "Valor médio do período de faturação" is read as the arithmetic mean of OMIE prices over the monthly billing period; the FIN does not define the averaging.

## U7 VAT reduced rate on energy before 2025

The Código do IVA page shows only the current wording of Lista I, verba 2.38 (200 kWh per 30 days, from 2025-01-01, Lei n.º 38/2024). The wording in force during 2024 (believed to be a lower threshold) is not on that page and the Diário da República page could not be read without JavaScript. The catalogue has no reduced-rate energy rule for 2024 dates.

## U8 IEC, DGEG fee and audiovisual contribution amounts

IEC 0,001 EUR/kWh, DGEG 0,07 EUR/month and CAV 0,09363 EUR/day were verified only on a supplier's public page (Coopérnico), not on the legal texts. The exemption of the audiovisual contribution for low annual consumption and the history of these amounts before 2026 were not verified, so no exemption is encoded and the current amounts are applied to the whole period. The VAT rates on them are verified on the Código do IVA (23 % standard rate; 6 % for the audiovisual contribution, Lista I, verba 2.2).

## U9 Fixed-offer prices verified on ERSE open data, not on supplier pages

Prices for the EDP, Goldenergy, MEO Energia, EZU Energia and Rockwatt fixed offers come from the ERSE price comparison open data (CSV of 2026-10-02 10:30). The supplier pages load prices with JavaScript and could not be read directly. A Repsol offer was left out because its page price includes an optional bundled service and did not match the ERSE list.

## U10 Bi-hourly cycle offered by each supplier

The ERSE price list has no cycle dimension: one bi-hourly price applies to both the daily and the weekly cycle. The `cycle` stated per bi-hourly offer is the cycle this catalogue models; that each supplier offers that cycle at that price could not be confirmed on the supplier pages.

## U11 ERSE cycle hours before 2026

The ERSE page (updated 2026-10-01) shows the cycle hours currently in force. It does not state that the same hours applied in 2024 and 2025; the catalogue assumes they did.

## U12 VAT on the power term up to 3.45 kVA

Lista I, verba 2.33 grants 6 % on the "componente fixa das tarifas de acesso às redes" up to 3.45 kVA. The catalogue applies 6 % to the TAR part of the power term only and 23 % to the rest. How each supplier splits the power term on its invoices was not verified.

## U13 EDP average-price indexed offer: averaging method

The FIN defines POMIE as the average OMIE PT price "apurado de acordo com a opção tarifária contratada e para o período de consumo". The catalogue reads this as the arithmetic mean of OMIE prices in each tariff period over the monthly billing period; consumption weighting is not stated.

## U14 Social tariff financing in past periods

The social tariff financing values (0,002067 and 0,0020666 EUR/kWh) are the values the suppliers publish for 2026. The values for 2024 and 2025 were not verified, so the 2026 value is applied to the whole period.
