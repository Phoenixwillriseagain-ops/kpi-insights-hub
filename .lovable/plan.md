## Goal

Stop the main-thread freeze that happens on the GitHub Pages build after 2–3 clicks. Locally it works because Vite dev serves modules lazily; the production SPA ships one ~1MB `routes` chunk that runs all parsing + Recharts on the UI thread.

## Changes

### 1. Web Worker for parsing & aggregation (primary fix)

Create `src/lib/analyzer/worker.ts`:
- Receives raw `ArrayBuffer`s for SLA / Breach / Exclusion files (transferable, zero-copy).
- Inside the worker: `XLSX.read` each buffer, then run `buildReport`, `buildExclMappings`, `buildDataset`.
- Posts back `{ ok, report, exclMappings, ds }` (Dataset is plain data — already serializable).

Update `runAnalysis` in `src/routes/index.tsx`:
- Read each uploaded `File` to `ArrayBuffer`.
- Instantiate the worker via `new Worker(new URL("../lib/analyzer/worker.ts", import.meta.url), { type: "module" })` so Vite emits it as a separate chunk.
- Await the response, then `setState`. Remove the `yieldToBrowser` shuffle.
- Terminate the worker after each run.

Result: `xlsx` parsing + dataset/report construction never touch the UI thread.

### 2. Code-split heavy libraries

Update `vite.config.pages.ts` `build.rollupOptions.output.manualChunks` to break out:
- `recharts`
- `xlsx` (only loaded by the worker → drops it from the main bundle entirely)
- `@radix-ui/*` group
- `html-to-image` (export-only)

Raise `chunkSizeWarningLimit` to 1500.

### 3. Lazy-load tab sections

Split each panel component out of the 1613-line `src/routes/index.tsx` into its own file under `src/components/sections/` (Monthly, Weekly, Queues, Pcms, QualityReopens, Overview). Load them with `React.lazy` + `<Suspense fallback={…}>` so a tab's chart code is only parsed when that tab is first opened. This is the main reason a fresh Pages session locks after a few clicks — every section's Recharts subtree is in the initial chunk.

Keep `DeferredMount` (it already defers the chart mount by one frame and is fine).

### 4. Verification

- `bunx vite build --config vite.config.pages.ts` and confirm:
  - Multiple chunks emitted (`xlsx-*.js`, `recharts-*.js`, per-section chunks).
  - Main `routes` chunk well under 500KB.
- Playwright run against the built `dist/` served statically: upload SLA file, click Overview/Monthly/Weekly/Queues repeatedly, assert no long task > 200ms and no freeze.

## Out of scope

- No change to KPI logic, RAG thresholds, validation rules, or visuals.
- No change to deploy workflow other than what `vite.config.pages.ts` already does.
