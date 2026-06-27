# Plan — Pulse v2: clearer trends + PCms integration

## 1. Re-label the three upload slots

Keep three slots, with explicit roles:

1. **SLA Overall** — `V2-breaches.xlsx`-style workbook. One sheet per KPI (KSL-4, KM-1, KSL-5a, KM-2, KSL-5b, …) with `Excluded` flag per row. This is the source for all KPI rates (existing parser already handles it).
2. **Exclusions register** — optional override list of ticket IDs to exclude on top of the per-row flag (unchanged behavior, just renamed in UI).
3. **KSL-5b Deep-dive (PCms)** — `NEW PCms file.xlsx`. New parser reads the `Summary` sheet (per-ticket reason category 1–11) and `Overall` sheet (Week / Month / Ticket / Reason / Agent / BMS ID / NOK/KO / Unique).

Upload card copy and helper text updated; old "Enriched breaches" wording removed.

## 2. New parser + data model for PCms

New module `src/lib/analyzer/parsePcms.ts`:

- Reads the `Overall` sheet (canonical), falls back to `Summary` if missing.
- Normalizes: `{ ticket, week, month, reason, category (1–11), agent, bmsId, status (KO/NOK), unique }`.
- Derives `category` from the reason prefix (`"2. KO Missing 5-days template"` → category `2 — Communication`) using a small map matching the workbook's 11 buckets.
- ISO month/week normalized to match the SLA dataset keys so they can be cross-filtered by the same period chip.

Extended `Dataset` type gets `pcms: PcmsRow[]` and helper selectors:
`pcmsByCategory(month)`, `pcmsTopAgents(month, n)`, `pcmsWeekly(lastN)`.

## 3. Fix the unreadable weekly chart

In `WeeklySection`:

- Reduce inline annotations: keep the value label above each point; **move ±pp deltas out of the chart** into the table.
- Increase y-axis padding (min/max ±1pp) so labels don't collide with the axis.
- Slightly larger left margin and a `dy` offset for the value label.
- For very dense values (<1pp gap between adjacent points), only show the value label, never the delta arrow.

Below every weekly chart, render a **companion data table** (always visible, responsive: side-by-side ≥1280px, stacked below):

| Week | Total | Breaches | Rate | Δ vs prev | Status |

Status uses the same RAG dot. Both the chart and the table sit inside the same `Panel` so the existing PNG/JPEG/CSV exports capture them together.

## 4. KSL-5b deep-dive section (new tab "KSL-5b Detail")

Only enabled when the PCms file is uploaded. Sections:

1. **Reason mix (stacked bar)** — by month (default) or week toggle, 11 categories stacked, 100%-stacked switch. Legend is interactive (click to isolate a category).
2. **Top agents by KO count** — horizontal bar, top 10, with hover tooltip showing reason breakdown for that agent; click a bar to filter the drill table.
3. **KSL-5b weekly trend overlay** — the existing KSL-5b line chart gets a secondary axis bar series = PCms KO count per week, so dips in conformity visually align with KO spikes.
4. **Reason-category drill table** — virtualized table (ticket / week / month / reason / agent / status), with category and agent filter chips, search box, and CSV export.

All four panels respect the global month chip and have their own PNG/JPEG export menu.

## 5. Interaction polish (modern dashboard feel)

- Period chips become a sticky sub-header with a "compare to previous" toggle that drives Δ columns globally.
- Cross-filter: clicking an agent or category anywhere filters all KSL-5b Detail panels (local state, resettable with a "Clear filters" pill).
- Empty states for each PCms panel ("Upload the PCms file to see this view") with a button that focuses slot 3.
- Keyboard: Tab order across slots → period chips → tabs → panels; `?` opens a small shortcuts popover (g o / g w / g m / g q / g 5).

## 6. Exports

- Per-panel PNG/JPEG (unchanged) — now also captures the companion weekly table.
- Workbook export gets two new sheets when PCms is present: `PCms Reasons`, `PCms Top Agents`.

## Technical notes

- New files: `src/lib/analyzer/parsePcms.ts`, `src/lib/analyzer/pcms.ts` (selectors), `src/routes/index.tsx` gains a `KSL5bDetail` section component (kept in same file to match current structure, or split into `src/components/sections/Ksl5bDetail.tsx` if it exceeds ~250 lines).
- `Dataset` in `parse.ts` extended with `pcms` array + `pcmsLoaded: boolean`; existing computations untouched.
- Weekly chart fix is purely presentational (`WeeklySection` in `src/routes/index.tsx`) — no changes to `compute.ts`.
- No new runtime deps; reuses `xlsx`, `recharts`, `html-to-image` already in the project.

## Out of scope

- Persistence / server storage (still 100% client-side, GitHub Pages friendly).
- Auth, sharing links, multi-user state.
