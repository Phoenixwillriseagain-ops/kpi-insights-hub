// Lightweight in-app performance instrumentation. No external deps.
// Activated by appending `?perf=1` to the URL or running
// `localStorage.setItem('perf','1')` in the console.

export type PerfEntry = {
  id: number;
  ts: number;        // ms since perf init
  label: string;
  duration?: number; // ms (for measure entries)
  kind: "mark" | "measure" | "longtask" | "info";
  detail?: string;
};

const subs = new Set<(entries: PerfEntry[]) => void>();
const buffer: PerfEntry[] = [];
const MAX = 200;
let nextId = 1;
const t0 = performance.now();

function enabledNow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1") return true;
    return window.localStorage.getItem("perf") === "1";
  } catch {
    return false;
  }
}

function emit(e: Omit<PerfEntry, "id" | "ts">) {
  if (!enabledNow()) return;
  const entry: PerfEntry = { ...e, id: nextId++, ts: performance.now() - t0 };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  subs.forEach((fn) => fn(buffer));
  // Mirror to console so non-panel users still see it.
  const dur = entry.duration != null ? ` (${entry.duration.toFixed(1)}ms)` : "";
  // eslint-disable-next-line no-console
  console.log(`[perf] ${entry.label}${dur}${entry.detail ? ` — ${entry.detail}` : ""}`);
}

export function perfMark(label: string, detail?: string) {
  emit({ label, kind: "mark", detail });
}

export async function perfMeasure<T>(label: string, fn: () => Promise<T> | T, detail?: string): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    emit({ label, kind: "measure", duration: performance.now() - start, detail });
  }
}

export function perfSubscribe(fn: (entries: PerfEntry[]) => void): () => void {
  subs.add(fn);
  fn(buffer);
  return () => { subs.delete(fn); };
}

export function isPerfEnabled(): boolean {
  return enabledNow();
}

// Capture browser-reported long tasks (>50ms blocking main thread).
let longTaskInstalled = false;
export function installLongTaskObserver() {
  if (!enabledNow() || longTaskInstalled || typeof PerformanceObserver === "undefined") return;
  longTaskInstalled = true;
  try {
    const obs = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        emit({
          label: "long-task",
          kind: "longtask",
          duration: entry.duration,
          detail: (entry as PerformanceEntry & { name?: string }).name ?? undefined,
        });
      });
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask not supported in this browser */
  }
}
