# Plan — adapt dashboard to the real V2 workbook

The previously-built scaffolding (routes, KPI cards, charts, GitHub Pages workflow) stays. The parser, aggregation, exclusion model and UI surfaces that depend on them get rewritten to match the actual file format you uploaded.

## File model (confirmed)

- One sheet per KPI: `KM-1, KM-2, KSL-1, KSL-2a, KSL-2b, KSL-2c, KSL-2d, KSL-3a, KSL-4, KSL-5a, KSL-5b, KSL-6`.
- Each sheet row = one ticket evaluated for that KPI. Columns used:
  `Incident Ticket, DATE_CLOSE, Queue, ISO_Language, SLA_Code, Breach_Description, Excluded, Week`.
- A row is a **breach** when `Breach_Description` is non-empty; otherwise it counted toward applicable but did not breach.
- `Excluded` is per-row (`'0'` / `'1'`).
- ISO week is derived from `DATE_CLOSE`.

## KPI formulas

- KSL family: `SLA% = (total − breaches) / total`
- KM family:  `KPI% = breaches / total`
- Targets/thresholds keep the existing `kpiConfig.ts` table.

## Exclusion model — side-by-side

No global toggle. Every metric is computed twice in one pass:

- **Before exclusion**: all rows in the sheet.
- **After exclusion**: rows where `Excluded != '1'`.

Both numbers are shown together everywhere (cards, table cells, chart series).

## Files to change

1. `src/lib/parseWorkbook.ts` — full rewrite.
   - Iterate every sheet whose name matches a KPI code.
   - For each row produce: `{ kpiCode, ticket, queue, market: ISO_Language, weekKey, weekLabel, excluded: boolean, breach: boolean }`.
   - Output `ParsedWorkbook { records, weeks, weekLabels, markets, queues, kpisFound[] }`.

2. `src/lib/aggregate.ts` — rewrite around `records`.
   - `aggregateKpi(records, kpiCode, { weekKey?, queue?, market? }) → { before: {total, breach, pct}, after: {…} }`.
   - `kpiTrend(records, kpiCode, lastNWeeks=6) → Array<{ weekLabel, beforePct, afterPct, beforeBreach, afterBreach, total }>`.
   - `marketBreakdown(records, kpiCode) → per ISO_Language rollup (before & after)`.
   - `queueBreakdown(records, kpiCode, market) → per Queue rollup (before & after)`.

3. `src/lib/kpiConfig.ts` — add `family: "KSL" | "KM"` and a `direction` (higher-better for KSL, lower-better for KM) so status colors flip correctly for KM.

4. `src/context/DataContext.tsx` — drop the global exclusion toggle; expose `records` + helpers. Keep single-workbook upload (no second exclusion file).

5. `src/components/AppHeader.tsx` — remove the Before/After switch; show parsed-file name + a re-upload button.

6. `src/components/KpiCard.tsx` — show two stacked figures: `Before  XX.X%` and `After  XX.X%` with a small delta, plus breach count `(b / total)` underneath. Status pill driven by the After value vs target.

7. `src/routes/index.tsx` — upload card with detection summary (sheets found, weeks detected, ticket count, markets list).

8. `src/routes/overview.tsx` — KPI grid (all 12 KPIs) using the new cards; summary table columns: `KPI | Target | Before % | After % | Breaches B/A | Total | Status`.

9. `src/routes/trend.tsx` — for each KPI render a Recharts `LineChart` with two lines (Before, After) over the last 6 ISO weeks of `DATE_CLOSE`, dashed target reference line. Week selector defaults to last 6.

10. `src/routes/queues.tsx` — Market filter (ISO_Language) → table of queues with Before/After % per KPI; clicking a queue opens a Sheet showing its 6-week Before/After trend for the selected KPI.

11. `README.md` — update file-format section (sheet-per-KPI, no second file, Excluded column drives the After view).

GitHub Actions workflow at `.github/workflows/deploy.yml` is unchanged.

## Technical notes

- Parsing stays 100% client-side with `xlsx` (SheetJS) — no data ever leaves the browser, matching the "GitHub Pages, stateless" requirement.
- ISO week key format `YYYY-Www` (sortable) with display label `Wxx 'yy`.
- "Breach" detection: `Breach_Description` trimmed string length > 0. (`SLA_N`/`SLA_Code` available for tooltips but not for the boolean.)
- KM cards/trends invert the status palette (higher % is worse).
- Empty-state guards on every route when no workbook is loaded.

## Out of scope

- Persisting uploads, multi-file merge, auth, server-side processing.
- A separate exclusion file (your data already carries `Excluded` per row).
