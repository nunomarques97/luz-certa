# E-Redes Balcão Digital 15-minute export

What the parser (`web/src/app/engine/eredes-parser.ts`) expects from the consumption file that a household downloads from the E-Redes Balcão Digital, where it came from, and what is still unconfirmed.

## Sources

E-Redes publishes no public specification of this file. The Balcão Digital (https://balcaodigital.e-redes.pt/) is a single-page application behind a login, and no public E-Redes page describing the export could be found on 2026-10-02. The layout below is therefore built from public open-source tools that read real exports. All were read on 2026-10-02:

1. **jpedrocr/eredes-omie**, `eredes_omie/e_redes/consumption_history.py`: https://github.com/jpedrocr/eredes-omie/blob/main/eredes_omie/e_redes/consumption_history.py. Downloads through the "Exportar excel" button. Files are named `Consumos_YYYYMMDD.xlsx`. It reads sheet `Leituras` with `skiprows=14` (header on row 15) and expects either 10 columns (keeping Data, Hora, consumption and injection) or 4 columns. It joins `Data` and `Hora` as text, subtracts 15 minutes (the time is the interval end), localises to `Europe/Lisbon` and divides kW by 4 to get kWh.
2. **tiagofelicia/simulador-tarifarios-eletricidade**, `processamento_dados.py`, function `processar_ficheiro_consumos`: https://github.com/tiagofelicia/simulador-tarifarios-eletricidade/blob/main/processamento_dados.py. Searches the first 20 rows for a header containing one of `Consumo medido na IC, Ativa (kW)`, `Consumo registado (kW)` or `Consumo registado, Ativa (kW)`. It computes kWh = kW / 4 and treats `00:00` as the end of the previous day.
3. **jd164/e-redes-powerscope**, `src/parser.js` and `sample/Consumos_PT0002000000000000AA_Exemplo.xlsx`: https://github.com/jd164/e-redes-powerscope. The sample is an anonymised file for August 2026, written with openpyxl (so a re-creation, not an untouched export). It shows the full metadata block, the 10-column header, text cells, the date and time formats and the decimal comma. The parser also maps `Estado` (Real or Estimado) and converts kW × 0.25 to kWh.

## Layout

One worksheet. The parser reads the first sheet, whatever its name (`Leituras` in source 1, `Dados de Energia` in source 3).

Rows 1 to 13 hold metadata, row 14 is empty and row 15 is the column header (source 3, consistent with `skiprows=14` in source 1):

| Row | Column A | Column B |
| --- | --- | --- |
| 1 | Dados Globais | |
| 3 | CPE | supply point code (personal data, never read by the parser) |
| 4 to 11 | Funções | the series in the file, each followed by "Estado" |
| 12 | Mês/Ano | e.g. "agosto 2026" |
| 13 | Intervalo: | 15 min |

Header (row 15) in the 10-column layout:

| Column | Header | Used |
| --- | --- | --- |
| A | Data | date of the interval end |
| B | Hora | time of the interval end |
| C | Consumo medido na IC, Ativa (kW) | consumption (preferred) |
| D | Estado | status of C |
| E | Injeção na rede medida na IC, Ativa (kW) | recognised, ignored |
| F | Estado | |
| G | Consumo registado (kW) | consumption (fallback) |
| H | Estado | |
| I | Injeção registada (kW) | recognised, ignored |
| J | Estado | |

Data rows follow from row 16, one per quarter-hour, in time order.

## Values

- **Date**: text `YYYY/MM/DD` (e.g. `2026/08/01`). The parser also accepts `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY` and Excel serial dates.
- **Time**: text `HH:MM`, the **end** of the quarter-hour. The first row of a day is `00:15`, and `00:00` with the next day's date closes the day. The parser also accepts `24:00`, `HH:MM:SS` with zero seconds, and Excel day fractions.
- **Consumption**: average power over the quarter-hour in **kW**, as text with a **decimal comma** (`0,348`; integers such as `0` have no decimals). Energy is **kWh = kW / 4**. Numeric cells and decimal points are also accepted.
- **Estado**: `Real` or `Estimado`. Estimated readings are counted and flagged, never dropped.
- **Time zone**: Portuguese legal time (Europe/Lisbon): WET in winter, WEST in summer.

## Daylight saving days

Lisbon changes clocks at 01:00 UTC on the last Sunday of March and of October. A quarter-hour export therefore has:

- **92 quarter-hours** on the spring-forward day (local 01:00 to 02:00 does not exist). Labels by interval end: `00:45`, `01:00`, `02:15`, ...
- **100 quarter-hours** on the fall-back day (local 01:00 to 02:00 happens twice). Labels: `01:15` to `02:00` in summer time, then `01:15` to `02:00` again in winter time.

The parser resolves each label by the offset in force during the interval. Inside the repeated hour, it assigns the first occurrence to summer time and the second to winter time, using row order. On the spring day, the jump instant is accepted whether it is labelled `01:00` or `02:00`. Labels that cannot exist (`01:15` to `01:45` on the spring day) are rejected.

## Parser output and checks

- Intervals carry the UTC start, the Lisbon local date and minute, the offset, kW, kWh and the estimated flag.
- Metadata: period start and end (Lisbon time with offset), interval count, expected count, missing quarter-hours (counted and listed by range, never filled), duplicates (first reading kept), estimated count, total kWh and the consumption column used.
- Typed rejections (`web/src/app/engine/parse-errors.ts`): `NOT_XLSX`, `FILE_TOO_LARGE` (over 25 MB), `DECOMPRESSED_TOO_LARGE` (over 200 MB), `MALFORMED_XLSX`, `MISSING_COLUMNS`, `UNKNOWN_COLUMN`, `NOT_15_MINUTE`, `INVALID_DATE`, `INVALID_VALUE`, `TOO_MANY_ROWS`, `NO_DATA`. Error details contain only row and column numbers, never text from the file.
- Empty consumption cells count as missing quarter-hours. Fully empty rows are skipped.
- `NOT_15_MINUTE` is raised when the metadata declares another interval, when a time is not on a quarter-hour, or when at most half of the consecutive readings are 15 minutes apart (for example an hourly file with a stray quarter-hour pair). Gaps in a 15-minute file are exceptions and are reported as missing quarter-hours.
- The sheet XML is read in a single forward pass, so crafted markup (thousands of unclosed tags) cannot make parsing slower than linear. Only the first 64 columns of each row are kept; cells further right are checked for order and ignored, so a far column reference cannot exhaust memory.

## Not confirmed

These points could not be confirmed from a public source and are handled defensively:

1. **How a real export labels the DST days.** No public source shows a spring or autumn day. Whether E-Redes writes `01:00` or `02:00` for the jump, and whether the repeated autumn hour appears twice in order, is assumed from the interval-end convention. The parser accepts both spring labels and relies on row order in autumn.
2. **Official column names and their meaning.** The names come from third-party tools. For households with solar self-consumption, "Consumo medido na IC" is assumed to be energy drawn from the grid, and "Consumo registado" to include self-consumption (source 3 computes self-consumption as their difference). The parser prefers "Consumo medido na IC, Ativa (kW)", then "Consumo registado, Ativa (kW)", then "Consumo registado (kW)".
3. **The exact 4-column layout.** Source 1 handles a 4-column file and source 2 accepts `Consumo registado (kW)` on its own, but neither shows the full header. The synthetic 4-column fixture uses `Data | Hora | Consumo registado (kW) | Estado`.
4. **Cell types.** Source 3 stores everything as text. Real exports may use numbers or dates instead. All of these are accepted.
5. **Empty or missing quarter-hours.** It is unknown whether E-Redes omits rows, leaves cells empty or writes `0` when there is no reading. Omitted rows and empty cells count as missing; `0` is a valid reading.
6. **Multi-month and yearly downloads.** Source 3 describes files from one month up to whole years. A single-sheet layout is assumed for all of them.
7. **Unknown extra columns.** Any header the parser does not know is rejected (`UNKNOWN_COLUMN`) rather than guessed. If E-Redes adds a column, the parser must be updated.

The first real export a user tries locally should confirm or correct these points. Never commit that file. Only synthetic fixtures under `fixtures/synthetic/` are allowed.
