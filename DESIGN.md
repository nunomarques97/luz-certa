# Design

Visual contract for the Luz Certa screens. The prototypes and their screenshots are in [docs/ui/](docs/ui/). Regenerate the screenshots with `npm --prefix web run design:shots`.

## Chosen direction: A, ranked report

**The Sponsor may override this choice.** To pick another direction, replace this section with B or C and adapt the rest of this file. The prototypes for all three stay in `docs/ui/directions/`.

The user's question is "which offer would have cost me less, and by how much compared with mine?". Direction A answers it in the first screen: the cheapest total in large figures, the delta against the current tariff, and the current tariff's own total and position next to it. The ranking below reads as a list of answers to the same question. Each row has a delta badge and a bar that grows left (cheaper) or right (dearer) from a line marking the current tariff.

The other two directions were drawn with the same content and rejected as the default:

| Direction | Prototype | Strength | Why not the default |
| --- | --- | --- | --- |
| A, ranked report | `docs/ui/directions/ranked-report/` | The answer and the delta come first. Simple to scan on a phone. | The load curve itself is not shown. A heatmap can come later as a secondary section. |
| B, load curve first | `docs/ui/directions/load-curve/` | Explains *why* an offer wins: the year heatmap leads, and each tariff has a 24-hour price strip read against the user's hourly profile. | The answer to the question sits below the heatmap, about one screen down. The dark palette and canvas heatmap need extra accessibility work: a text equivalent of 8 760 cells. |
| C, bill ledger | `docs/ui/directions/bill-ledger/` | Every offer is an itemised annual bill (energy, power, fees, VAT), which is very transparent. | Five figures per row compete with the total, so the delta is harder to find. On mobile, 11 receipts make a long scroll before the monthly view. |

Ideas worth keeping from B and C for later versions: the 24-hour price strip (B) to explain bi-hourly and indexed offers, and the itemised breakdown (C) as a per-offer detail view.

Screenshots (full page, 1440 px at 1x and 390 px at 2x):

| | Upload | Results |
| --- | --- | --- |
| A | `ranked-report-upload-1440.png`, `ranked-report-upload-390.png`, error state `ranked-report-upload-error-{1440,390}.png` | `ranked-report-results-1440.png`, `ranked-report-results-390.png` |
| B | `load-curve-upload-1440.png`, `load-curve-upload-390.png` | `load-curve-results-1440.png`, `load-curve-results-390.png` |
| C | `bill-ledger-upload-1440.png`, `bill-ledger-upload-390.png` | `bill-ledger-results-1440.png`, `bill-ledger-results-390.png` |

## Organizing rule

**Everything is measured against the user's current tariff.** The current tariff is the zero line. The dominant figure is the cheapest period cost, and right next to it is the difference from the current tariff. In the ranking, the current tariff is a row in its own position, marked with an ink rule and a "a sua tarifa" badge. Every other row says how far it is from that row, in euros and as a bar from the zero line. The monthly table compares the current tariff with one offer the user picks (the cheapest by default).

Hierarchy on the results screen:

1. Dominant: the answer block (cheapest total, offer name, delta badge, caveat when the value is understated) and the current-tariff card (total, position out of 11).
2. Secondary: the ranking of all tariffs, cheapest first, then the monthly breakdown.
3. Quiet: the context line (period, kWh, kVA, file name, edit links), assumptions, sources, and the closing note that no position is paid or sponsored.

When the cheapest offer is understated (it leaves out components without a published value), the answer block says so next to the figure. It also names the cheapest offer without that caveat. An answer is never shown without its caveat.

## Colour variables

Defined in `docs/ui/directions/ranked-report/theme.css`. The Angular app copies them into `web/src/theme.css`. Never name the file with "token": that name is git-ignored.

| Variable | Value | Use |
| --- | --- | --- |
| `--paper` | `#f6f5f1` | page background |
| `--surface` | `#ffffff` | cards, current-tariff row, upload zone |
| `--ink` | `#15181c` | text, current-tariff marker, primary button |
| `--ink-2` | `#4a5058` | secondary text |
| `--line` | `#d9d6cc` | rules, table borders (decorative) |
| `--line-strong` | `#8d8a80` | upload zone border, select border |
| `--cheaper` / `--cheaper-bg` | `#0b6b4c` / `#e1f1e8` | cheaper than current: badge, bar, table figure |
| `--dearer` / `--dearer-bg` | `#a2391e` / `#f8e5dd` | dearer than current |
| `--caution` / `--caution-bg` | `#7a4f00` / `#fbefd5` | "valor mínimo" tag for understated costs |
| `--danger` / `--danger-bg` | `#a11d2b` / `#fbe7e8` | error banner |
| `--focus` | `#1f5fd1` | focus outline |

Cheaper and dearer are never shown by colour alone. Badges carry a ▼ or ▲ sign and the words "menos" or "mais". Table figures carry a − or + sign.

### Contrast targets (WCAG 2.2 AA)

Text needs at least 4.5:1, and large text and non-text UI need at least 3:1. Measured ratios:

| Pair | Ratio |
| --- | --- |
| ink on paper | 16.3 |
| ink-2 on paper / on surface | 7.5 / 8.1 |
| cheaper on cheaper-bg / on paper | 5.6 / 6.0 |
| dearer on dearer-bg / on paper | 5.5 / 6.1 |
| caution on caution-bg | 6.3 |
| danger on danger-bg | 6.5 |
| white on ink (primary button) | 17.8 |
| focus outline on paper / surface | 5.3 / 5.8 |
| line-strong on surface (upload zone border) | 3.5 |

## Type scale

The system font stack is `'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`. There are no web fonts and no third-party requests. Figures use `font-variant-numeric: tabular-nums` so the euro columns align.

| Variable | Size | Use |
| --- | --- | --- |
| `--text-hero` | 72 px (48 px at 720 px or less) | the answer figure |
| `--text-2xl` | 36 px (28 px) | upload question (h1) |
| `--text-xl` | 24 px (21 px) | section titles (h2), current-tariff total |
| `--text-lg` | 19 px | answer eyebrow, lead text, row cost |
| `--text-md` | 16 px | body, offer names |
| `--text-sm` | 15 px | tables, badges, secondary text |
| `--text-xs` | 13 px | row metadata (kind, source, verified on), tags |

Weights: 700 for the answer figure and h1, 650 for h2 and the row cost, 600 for badges and labels, and 400 for everything else.

## Spacing

The scale is `--space-1` to `--space-8`: 4, 8, 12, 16, 24, 32, 48 and 72 px. The page is at most 1200 px wide, with 32 px side padding (16 px on mobile). Sections are separated by a 1 px rule and 48 px of padding (32 px on mobile). The radius is 6 px; badges and tags are pills.

## Components

- **Upload zone**: a dashed `--line-strong` border on `--surface`. It holds an icon, "Arraste o ficheiro para aqui", "ou", a native `<input type="file" accept=".xlsx">` behind a `<label class="button">`, and the hint "Ficheiro .xlsx exportado pela E-Redes, até 25 MB". The drag-over state uses a `--focus` border and a light blue fill. Directly below it is the privacy statement "O ficheiro não sai do seu dispositivo." with one line of explanation. Beside it on desktop (below it on mobile) is the four-step guide to getting the file.
- **Error banner**: `role="alert"`, `--danger` border with a 6 px left rule, `--danger-bg` fill. It has a title stating what failed, one sentence on what to do, and a retry action (a secondary button). It sits above the upload zone, never replacing it, so the user can retry at once.
- **Answer block**: an eyebrow sentence, the hero figure, "com <oferta>", a large delta badge, and a caveat line when the value is understated. Beside it is the **current-tariff card**: a 2 px ink border, the current total and the position out of 11.
- **Ranking row**: an ordered list item with rank, name, a metadata line (kind: fixed or indexed, simple or bi-hourly and its cycle; source link and verified-on date), cost, delta badge and delta bar. The current tariff's row has a white fill and a 4 px ink rule on the left. Understated offers carry the "valor mínimo" tag. When the period is not a whole year, the cost cell shows the period cost with the annualised value under it ("por ano: 1 012,40 €").
- **Delta badge**: a pill with an arrow sign, an amount and "menos" or "mais". The current tariff's badge reads "a sua tarifa" with an ink outline.
- **Delta bar**: decorative (`aria-hidden`). The ink zero line is at the centre, and the bar length is proportional to the largest absolute delta.
- **Monthly chart and table**: a native `<select>` "Comparar a sua tarifa com" (cheapest by default). A grouped SVG bar chart (ink = current, cheaper or dearer colour = compared offer) with `role="img"` and an `aria-label`. The table (month, kWh, current, offer, difference, with a total row) is the accessible equivalent and always shown.
- **Assumptions list**: always visible, never collapsed by default. A numbered list of assumptions for every tariff, then per-offer notes, then a sources table (offer, source link, verified on). Missing-data notices (missing quarter-hours, estimated readings, unpriced OMIE periods) go first in this list and are repeated in the context line when there are any.

## Mobile reorganisation (720 px or less)

- The answer block stacks: eyebrow, then a 48 px figure, then the offer name, then the delta badge, which may wrap. The current-tariff card becomes a two-column strip below it.
- Ranking rows become two-line cards: rank and name on top, then cost (left) and delta badge (right), then the delta bar across the full width. The column header scale is hidden.
- The monthly select takes the full width with its label above. The chart redraws at the container width. The table drops the kWh column.
- The assumptions become one column, and the sources table drops the verified-on column (the row metadata already shows it).
- The guide on the upload screen moves below the upload zone, and the drag text is hidden: touch users get only the "Escolher ficheiro" button.

## Focus and keyboard

All controls are native (`button`, `a`, `select`, `input type=file` through its `label`). Focus is a 3 px `--focus` outline with a 2 px offset on `:focus-visible`, never removed. Status changes (processing, done, error) are announced in an `aria-live="polite"` region without moving focus. The error banner uses `role="alert"`.

## Reduced motion

Only the delta bar width has a transition (200 ms ease-out), inside `@media (prefers-reduced-motion: no-preference)`. With reduced motion, everything changes instantly. Motion would only reinforce that a bar grew from the zero line; the static bar already shows this.

## Copy rules

European Portuguese, no em-dashes, nothing about how the tool was built, and no ranking position that is paid or sponsored. Amounts use `pt-PT` formatting (`943,25 €`). Negative deltas use the minus sign (−).

## Known weaknesses

- The prototypes use the system font. On Windows that is Segoe UI; on other systems the metrics differ slightly.
- The page does not show *why* an offer wins (the load-curve view of B). The ranking metadata and the monthly table carry that for v0.1.
- The prototype shows only the full-year state. The annualised label for partial files and the missing-data notices are specified above but not drawn.
