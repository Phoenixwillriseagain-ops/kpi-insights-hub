## Why tab clicks feel laggy

Radix `Tabs` unmounts the inactive tab and remounts the new one. Each section (Overview, Trends, Queues, PCms, Quality) mounts **~10+ Recharts `ResponsiveContainer` trees in the same task** as the click handler, so the `mousedown` blocks for ~200 ms while React + Recharts walk every chart, measure SVGs, and run their internal `ResizeObserver` setup.

The compute layer is already cached (previous turn) — this is purely render cost on tab change.

## Fix: defer chart mounting one frame after the tab opens

Add a single tiny utility and apply it where the cost actually lives. No layout or visual changes.

### 1. `src/components/DeferredMount.tsx` (new)

```tsx
export function DeferredMount({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return <>{ready ? children : (fallback ?? <div className="h-[240px] animate-pulse rounded bg-secondary/30" />)}</>;
}
```

Effect: the tab swap commits instantly with placeholders; charts paint on the next frame, so the click handler returns in <50 ms.

### 2. Wrap chart bodies inside `Panel` children (one section at a time)

Touch only `src/routes/index.tsx`. In each of `MonthlySection`, `WeeklySection`, `QueuesSection`, `PcmsSection`, `QualityReopenSection`, wrap the `<ResponsiveContainer>…</ResponsiveContainer>` block (and the companion `WeeklyTable` where it sits next to a chart) with `<DeferredMount>`. The surrounding `Panel` header, export menu, and selectors render immediately so the UI feels live.

KPI tiles in Overview stay as-is — their sparklines are cheap; the real cost is the big chart panels.

### 3. Memoize section roots

Wrap `MonthlySection`, `WeeklySection`, `QueuesSection`, `PcmsSection`, `QualityReopenSection` in `React.memo`. Props (`ds`, `detected`, `month`) are stable references between tab switches, so the second visit to a tab will skip re-rendering subtrees that didn't change.

### 4. Keep tab unmounting (don't `forceMount`)

`forceMount`-ing all tabs would mount every chart on first dashboard render and make the *initial* load worse — the current symptom would just move from "tab click slow" to "first paint after upload slow". The deferred-mount approach keeps memory low and spreads work across frames.

## Out of scope
- No compute changes (cache layer from previous turn already covers it).
- No styling, layout, or export behavior changes.
- No Recharts replacement.

## Verification
1. Upload the 15 MB SLA + PCms + Exclusions.
2. Click each top tab in turn — expect the active tab content to swap immediately with a brief skeleton, then charts to render within ~1 frame.
3. Console should no longer show `mousedown` violations on tab switch (a one-off `requestAnimationFrame` warning is fine and expected).
4. Confirm numbers and exports still match.

## Files touched
- `src/components/DeferredMount.tsx` (new, ~12 lines)
- `src/routes/index.tsx` (wrap chart bodies; `React.memo` five section components)
