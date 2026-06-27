## Diagnosis

The freeze only on GitHub Pages (production build) after 2–3 clicks is caused by the `KeepAliveTab` pattern we added last turn:

- Each visited tab is `forceMount`-ed and Radix simply sets `hidden` on inactive panels.
- Every `ResponsiveContainer` inside those hidden panels still mounts a `ResizeObserver`. In a hidden subtree it measures `0×0`, and Recharts re-runs layout on each resize callback.
- After 2–3 tab visits there are 10–20 of these observers all firing on every layout pass. In dev/preview React's slower path and StrictMode double-render mask it; the minified prod build on Pages tightens the loop into a freeze with no console error (Chrome silently swallows `ResizeObserver loop completed with undelivered notifications`).

Local + Lovable preview "work" because they run the dev build with HMR overlay and StrictMode, which throttle the loop. The Pages bundle is the same code; the runtime characteristics differ.

## Fix

Drop keep-alive entirely and instead make tab switches cheap by deferring heavy work, not by hoarding mounted charts.

1. **`src/routes/index.tsx`**
   - Remove `KeepAliveTab` and the `visited` `Set` state. Replace each `<KeepAliveTab …>` with a plain `<TabsContent value="…">`.
   - Wrap each tab section's body in `<DeferredMount>` so the chart subtree mounts one animation frame after the tab header paints (we already have this component). This keeps the `mousedown`/tab-switch handler under the 50ms budget.
   - Keep the per-section `React.memo` and the `dsCache` in `compute.ts` — re-mounting is now O(layout) only, since aggregation is cached.

2. **`src/components/DeferredMount.tsx`** — no change needed; already renders a skeleton then swaps in children on next frame.

3. **No business-logic changes.** Aggregation, parsing, KPI math, exports all untouched.

## Verification

- Build with `bunx vite build --config vite.config.pages.ts` and serve `dist/` locally with `npx serve` under the `/kpi-insights-hub/` base.
- Drive Playwright headless, upload one SLA workbook, then click Overview → Monthly → Weekly → Queues → Quality → Overview → Monthly six more times. Record `performance.now()` around each click and confirm INP stays < 200ms and the page remains interactive (button click after the loop succeeds within 100ms).
- Watch `chrome://tracing`-style violations in the script's console capture; expect no further `setTimeout 80ms+` or `mousedown 200ms+` warnings after the first chart mount.

## Why this is the right call

Keep-alive trades remount cost for permanent observer cost. With our cache in `compute.ts`, remount is cheap; the observer leak is what actually breaks the page. Removing it eliminates the freeze without bringing back the original "click feels heavy" symptom, because `DeferredMount` already spreads the remount across a frame.
