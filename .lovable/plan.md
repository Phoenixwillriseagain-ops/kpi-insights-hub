# Dashboard Upgrade Plan

## 1. Weekly Trend → Line Chart with labels
- Replace the current weekly Bar chart with a Recharts `LineChart`.
- X axis: week label (e.g. `W23 '26`) using existing `weekLabel()` helper.
- Y axis: KPI % (hidden ticks, since labels live on points).
- Add a `<LabelList>` on the line showing the percentage value above each point (e.g. `96.4%`), color-matched to RAG status per dot.
- Keep target reference line (dashed) and RAG-colored dots.
- Tooltip keeps total / breaches / rate breakdown.

## 2. Export functionality
Two export surfaces:

**A. Chart image export (PNG / JPEG)**
- Add a small "Export" menu (dropdown) on every chart card (Overview sparkline area, Trends line & monthly bar, Queue chart, Exclusion Impact chart).
- Use `html-to-image` (lightweight, no canvas server deps) to render the chart container to PNG or JPEG.
- File name pattern: `pulse_<view>_<kpi>_<yyyymmdd>.png`.

**B. Report export**
- Top-bar "Export report" button with two options:
  - **CSV** — current view's underlying data (overall by KPI, weekly series, queue breakdown, exclusion impact) zipped into one `.csv` per section via a single multi-sheet `.xlsx` produced with the already-installed `xlsx` lib.
  - **PDF snapshot** — capture the active view's main container with `html-to-image` → embed into a single-page PDF using `jspdf` (auto-scaled to A4 landscape).
- Respects current month filter and selected KPI.

## 3. Other improvements
- **Sticky header + view tabs** so navigation stays visible when scrolling long queue lists.
- **Empty / partial-upload state** clarifying which file is still missing (currently only a generic prompt).
- **KPI search / filter chips** above the KPI grid (filter by family: All / KSL / KM, plus free-text search by code).
- **Compare mode toggle** on Trends: overlay the previous 6-week window as a faint line for quick delta reading.
- **Accessibility**: add `aria-label`s to chart export buttons and ensure RAG colors also encode via icon (●/▲/■) for color-blind users.
- **Persist last-used month + KPI** in `sessionStorage` so a refresh keeps context (no data persistence — only UI state).

## Technical notes
- New deps: `html-to-image`, `jspdf` (both pure-JS, edge-safe; we only run them in the browser).
- New module `src/lib/analyzer/export.ts` with `exportNodeToImage(node, fmt)`, `exportWorkbook(sections)`, `exportViewToPdf(node, title)`.
- New component `src/components/ExportMenu.tsx` (shadcn `DropdownMenu`) attached to each chart card via a `ref`.
- Weekly chart refactor lives in `src/routes/index.tsx` Trends section; reusable as `WeeklyTrendChart` component in `src/components/charts/WeeklyTrendChart.tsx`.
- No backend changes; everything stays client-side and stateless.

## Out of scope
- Server-side rendering of exports, scheduled email reports, multi-page PDF with all KPIs (can follow up).
