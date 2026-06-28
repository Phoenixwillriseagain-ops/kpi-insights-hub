## Why it freezes on GitHub Pages

Two things compound:

1. **`xlsx` (≈500 KB) still loads on the main thread.** The worker chunk dynamic-imports it, but `parse.ts`, `parsePcms.ts`, `validate.ts`, and `export.ts` all do `import * as XLSX from "xlsx"` at the top. The main bundle value-imports `exclSet` (from `parse.ts`), `pcmsTopAgents`/`pcmsWeeklyCounts`/`PCMS_CATEGORIES` (from `parsePcms.ts`), and `exportDatasetWorkbook` (from `export.ts`). Through that chain, `xlsx` is pulled into the routes chunk and parsed on first paint, so by the time the dataset is also live the UI thread is heavily loaded.
2. **`exportDatasetWorkbook` runs synchronously on the main thread.** It builds 5 sheets via `XLSX.utils.json_to_sheet` and `XLSX.writeFile`, which on a 15 MB dataset freezes the tab — that's why "I can't also export".

The reason it shows up specifically after 2–3 Overview interactions is that the Overview tab is the heaviest one (4 `StatBlock`s + N `KpiTile`s, each running `weeklySummary`/`overallByKpi`/`rawOverallByKpi`/`exclusionImpact`). Each compute call is cached (WeakMap), but every render still walks the cache and the global `DeferredMount` queue (50 ms `setTimeout` per panel, no cancel on unmount) keeps firing pending activations from previously visited tabs, stacking timers.

## Fix

### 1. Get `xlsx` out of the main bundle

- New file `src/lib/analyzer/parseTypes.ts`: move `SlaRow`, `BreachRow`, `ExclRow`, `Dataset`, and the pure-JS `exclSet` here. No `xlsx` import.
- `parse.ts` keeps `readWorkbook`, `parseSla`, `parseBreach`, `parseExcl`, `buildDataset`. Re-export the types from `parseTypes.ts` for the worker.
- `compute.ts` and `routes/index.tsx` import from `parseTypes.ts` instead of `parse.ts` (types + `exclSet`).
- `parsePcms.ts`: split into `parsePcms.ts` (xlsx-bound `parsePcms`) and `pcmsAnalytics.ts` (pure: `PCMS_CATEGORIES`, `pcmsTopAgents`, `pcmsWeeklyCounts`, `pcmsByCategory`, `PcmsRow` type). Main bundle imports only the pure module; the worker imports `parsePcms`.
- `validate.ts`: keep types exported; main bundle continues to type-import only.

Net effect: the main route chunk no longer references `xlsx`. Only the worker chunk loads it.

### 2. Make `exportDatasetWorkbook` non-blocking

- Extend `worker.ts` with a second message type, `{ kind: "exportReport", ds, month }`, that runs the existing report builders + `XLSX.write` and posts back a `Uint8Array` for the main thread to download via a Blob URL.
- `Header` calls a new `exportReport(dataset, activeMonth)` helper that spawns the worker, awaits the bytes, and triggers the download. Show a toast while it runs so the user sees progress.

### 3. Make image exports lazy

- In `export.ts`, dynamic-import `html-to-image` inside `exportNodeAsImage` (`const { toPng, toJpeg } = await import("html-to-image")`). Removes ~80 KB from the initial bundle and avoids touching it until the user clicks an export icon.

### 4. Lazy-load tab section components

- Extract `OverviewSection`, `MonthlySection`, `WeeklySection`, `QueuesSection`, `ExclusionSection`, `QualityReopenSection`, and `Ksl5bDetail` into `src/components/sections/*.tsx` (one file each).
- Load each with `React.lazy` + `<Suspense fallback={<div className="h-48 animate-pulse rounded bg-secondary/30" />}>`.
- Result: a tab's Recharts/JSX tree is only parsed when that tab is first opened, cutting initial main-thread parse work substantially.

### 5. Fix `DeferredMount` queue leak

- Track the queued callback per instance and remove it from `queue` on unmount so we don't run activations for components that no longer exist.
- Replace `setTimeout(drain, 50)` with `requestAnimationFrame(drain)` so we yield once per frame instead of holding a 50 ms timer chain across tab switches.
- Remove the dead `useMountedTabs` gate (Radix `TabsContent` already unmounts hidden tabs; the `mountedTabs.has(...)` check is meaningless and just adds re-render churn).

### 6. Verification

- `bunx vite build --config vite.config.pages.ts` and assert from the bundle report:
  - No `xlsx` symbols in the `routes` chunk (only in `xlsx-*.js` loaded by the worker).
  - Separate `html-to-image-*.js` chunk emitted (lazy).
  - Per-section chunks emitted.
- Playwright against the built `dist/`: upload SLA + Exclusion files, then on the Overview tab click month chips and the Export Report button five times in a row. Assert no long task > 200 ms, no `ResizeObserver loop` violations, and that a `.xlsx` download fires within ~2 s.

## Out of scope

- No KPI logic, RAG thresholds, validation rules, or visual changes.
- No deploy workflow changes beyond what's already in `vite.config.pages.ts`.
