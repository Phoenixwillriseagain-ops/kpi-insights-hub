# KPI Dashboard

Interactive, fully client-side KPI dashboard. Drop your weekly SLA Excel file (and optionally an exclusion file) to explore:

- **Overview** — every KSL/KM KPI with status, tickets, and breaches
- **6-Week Trend** — last 6 ISO weeks with target reference line
- **Per Queue / Market** — filter by market (derived from `ISO_Language`) and drill into any queue

All parsing happens in the browser via SheetJS. **No data is uploaded or stored anywhere.**

## Expected Excel structure

The parser auto-detects columns by name. The main file needs at least:

- `Queue` — the queue / team name
- `ISO_Language` — language code that defines the market
- A date or week column — one of `Week`, `ISO_Week`, `CreatedAt`, `Created`, `CreationDate`, `Date`, `TicketDate`
- For each KPI (KSL-1, KSL-2a–d, KSL-3a, KSL-4, KSL-5a, KSL-5b, KSL-6, KM-1, KM-2): either
  - paired `<KPI>_Applicable` + `<KPI>_Breach` columns, **or**
  - a single column named `<KPI>` whose value is truthy when breached (`1`, `true`, `breach`, `ko`, `x`…)

If your column names differ, edit the candidate lists in `src/lib/parseWorkbook.ts` — they're column-name driven.

## KPI targets

Configured in `src/lib/kpiConfig.ts` — adjust target percentages and watch bands there.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In repo Settings → Pages, set **Source** to **GitHub Actions**.
3. The `.github/workflows/deploy.yml` workflow builds on every push to `main` and publishes to Pages.

If your repo is served from a subpath (e.g. `username.github.io/repo`), set `VITE_BASE_PATH=/repo/` and pass it through `vite.config.ts` as the `base` option.

## Local development

```bash
bun install
bun run dev
```
