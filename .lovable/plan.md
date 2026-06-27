## Why the dashboard freezes

Your SLA workbook is ~15 MB → likely 50–150k rows spread across ~10 KPI sheets. Two compounding problems hit the browser the moment Overview renders:

1. **Every KpiTile recomputes from raw rows on every render.** `KpiTile` calls `overallByKpi`, `rawOverallByKpi`, `exclusionImpact`-style filters and only memoizes the sparkline. With ~10 tiles, each scanning thousands of rows plus rebuilding the exclusion `Set` per call (`exclSet` is not cached), every state change re-scans the whole dataset N×3 times.
2. **`buildDataset` runs synchronously on the click** with no yield — the toast fires, the heavy Overview mounts in the same task, and the tab/Recharts mount layers on top. The tab bar then appears unresponsive even though the work eventually finishes.

Nothing is broken in the data layer; it's pure CPU pressure from un-cached scans.

## Fix

### 1. Per-dataset cache layer in `src/lib/analyzer/compute.ts`
Add a module-level `WeakMap<Dataset, …>` cache so heavy structures are built once per uploaded dataset:

- `exclSet(ds, code)` → cache the `Set` per (ds, code).
- New `groupedByMonth(ds, code)`, `groupedByWeek(ds, code)`, `groupedByQueue(ds, code, month)` returning the post-exclusion row buckets.
- `monthlySummary`, `weeklySummary`, `weeklyQueueSummary`, `queueBreakdown`, `overallByKpi`, `rawOverallByKpi`, `exclusionImpact` all re-implemented on top of these caches — same return shapes, no API change for callers.

Result: opening Overview becomes O(detected KPIs) lookups instead of O(KPIs × rows × 3 scans).

### 2. Lighter `KpiTile` in `src/routes/index.tsx`
Wrap `KpiTile` in `React.memo` and collapse its three calls into a single `useMemo([ds, code, month])` that returns `{ before, after, trend, delta, excludedCount }`. Same UI, single pass.

### 3. Unblock the main thread during `runAnalysis`
In `runAnalysis` (index route):
- Show the busy spinner immediately, then `await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))` before `buildReport` and again before `buildDataset` so the spinner paints.
- Wrap `buildDataset` in a `try/catch` that surfaces a toast on failure (today an exception silently flips `busy` off without telling the user).
- Add a lightweight "Preparing dashboard…" full-screen overlay between `setDataset(ds)` and the first Overview paint, dismissed on the next animation frame — this hides the one-time Recharts mount cost so the UI never appears "frozen".

### 4. No changes to
Parsers, validation, KPI definitions, file flow, exports, KSL‑5b / Quality / Queue / PCms section logic — they already call through the compute helpers and will pick up the speedup automatically.

## Verification
- Reload preview, upload your 15 MB SLA + PCms + Exclusions, click Run.
- Expect: spinner visible during parse, Overview paints in <1 s, tabs switch instantly, KPI tile interactions stay snappy.
- Sanity check numbers on Overview match the current values for a known KPI to confirm no behavior regression.

## Files touched
- `src/lib/analyzer/compute.ts` — add cache layer, refactor existing exports.
- `src/routes/index.tsx` — `React.memo` + consolidated `useMemo` for `KpiTile`; `runAnalysis` yield + overlay.
