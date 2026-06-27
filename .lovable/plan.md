## Goal

An interactive KPI dashboard that runs entirely in the browser. You upload two Excel files each session (main SLA file + exclusion file); nothing is stored server-side. Deployable as a static site to GitHub Pages.

## Pages / Views

1. **Upload** (landing) — drop zones for Main SLA file and Exclusion file. Both parsed in-browser, kept in memory only. Sticky header shows file names + "Clear" button. An "Include exclusion data" toggle appears once the exclusion file is loaded.
2. **Overview** — grid of KPI cards (KSL-1, KSL-2a..d, KSL-3a, KSL-4, KSL-5a, KSL-5b, KSL-6, KM-1, KM-2) matching screenshot 2: code, % value, tickets · breaches, label, status color (Good ≥ target, Watch within band, Risk below). Below: "All KPIs at a Glance" table (KPI, what it measures, target, tickets, breaches, rate, status badge).
3. **6-Week Trend** — for a selected KPI: line chart of last 6 ISO weeks with target reference line, latest value, total tickets + breaches (screenshot 1 layout). Below the chart, one card per week with %, tickets, breaches. KPI selector at top.
4. **Per-Queue / Market** — table + drill-down. Market derived from `ISO_Language`; queues grouped under their market. Filter chips for market and KPI. Clicking a queue opens a side panel with the same 6-week trend + KPI breakdown for just that queue.

Global toggle in the header: **Before exclusion / After exclusion** (only enabled when exclusion file is uploaded). Switches all values across all pages.

## Data Flow

- Parsing: `xlsx` library (SheetJS) in the browser. No server calls.
- Expected columns in the main file (based on your description): `Queue`, `ISO_Language`, a ticket/breach indicator per KPI, and a date or ISO-week column. **Exact column names confirmed against the uploaded file in build mode** — the parser will be column-name driven so adjustments are one config change.
- Week bucketing: ISO week (`Wxx 'yy`), last 6 weeks ending at the latest week present in the data.
- KPI registry (code, label, target %, target band) defined in a single config file so targets/labels can be tweaked without touching UI code.
- Exclusion file: same shape as main; the toggle swaps the active dataset in a React context. No "compare" view in v1 — just a clean toggle, as you chose.
- All computation memoised; recompute on file change or toggle change.

## Tech & Hosting

- TanStack Start with `ssr: false` on data routes (pure client) so it builds to a fully static bundle.
- Vite static build → published to the `gh-pages` branch via a GitHub Action (`actions/deploy-pages`). README will document: connect repo to Lovable, push, enable Pages → "GitHub Actions" source.
- No backend, no Lovable Cloud, no auth. Files never leave the browser tab.
- Charts: Recharts (already common in shadcn stack). Tables: shadcn `Table`. Styling matches your screenshots — soft green/red status cards, teal trend line, dashed target line.

## Technical Notes

- `src/lib/parseWorkbook.ts` — reads File → normalized rows `{ queue, market, isoWeek, kpi, tickets, breaches }`.
- `src/lib/kpiConfig.ts` — KPI list with targets/bands.
- `src/lib/aggregate.ts` — pure functions: `overallByKpi`, `trendByKpi(weeks=6)`, `byQueue`, `byMarket`.
- `src/context/DataContext.tsx` — holds main + exclusion datasets and the active-view toggle.
- Routes: `/` (upload), `/overview`, `/trend`, `/queues`.
- `.github/workflows/deploy.yml` — build + deploy to Pages on push to `main`.

## Open Items (resolved in build mode)

- Upload the main SLA file once we start building so the parser maps to the real column names and KPI metric columns.
- Confirm exact mapping from `ISO_Language` value → market label (or use the raw ISO code as the market name).
