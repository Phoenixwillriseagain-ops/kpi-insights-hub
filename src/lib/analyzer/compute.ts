import { KPI_META, calcTarget, type KpiCode } from "./kpi";
import { exclSet as rawExclSet, type Dataset, type SlaRow } from "./parseTypes";

export type PeriodPoint = {
  label: string;
  total: number;
  breaches: number;
  rate: number;
  rag: "green" | "amber" | "red" | "none";
};

export const WEEKLY_WINDOW = 6;

/* ───────────────────────── per-dataset cache ───────────────────────── */

type KpiCache = {
  exclSet: Set<string>;
  // all rows that survive exclusion (isExcluded=0 AND ticket not in excl file)
  clean: SlaRow[];
  // every row in the SLA sheet (used for "before exclusion" views)
  all: SlaRow[];
  byMonth: Map<string, SlaRow[]>;       // clean rows grouped by month
  byWeek: Map<string, SlaRow[]>;        // clean rows grouped by week
  byQueue: Map<string, SlaRow[]>;       // clean rows grouped by queue
  byQueueWeek: Map<string, Map<string, SlaRow[]>>; // queue -> week -> rows (raw — includes excluded)
  allByMonth: Map<string, SlaRow[]>;    // every row grouped by month
};

const dsCache = new WeakMap<Dataset, Map<KpiCode, KpiCache>>();

function cacheFor(ds: Dataset, code: KpiCode): KpiCache {
  let perDs = dsCache.get(ds);
  if (!perDs) { perDs = new Map(); dsCache.set(ds, perDs); }
  let entry = perDs.get(code);
  if (entry) return entry;

  const all = ds.sla[code] ?? [];
  const ex = rawExclSet(ds, code);
  const clean: SlaRow[] = [];
  const byMonth = new Map<string, SlaRow[]>();
  const byWeek = new Map<string, SlaRow[]>();
  const byQueue = new Map<string, SlaRow[]>();
  const byQueueWeek = new Map<string, Map<string, SlaRow[]>>();
  const allByMonth = new Map<string, SlaRow[]>();

  for (const r of all) {
    if (r.month && r.month !== "unknown") {
      (allByMonth.get(r.month) ?? allByMonth.set(r.month, []).get(r.month)!).push(r);
    }
    // raw queue-week index (used by weeklyQueueSummary raw)
    if (r.queue && r.week && r.week !== "No week") {
      let wm = byQueueWeek.get(r.queue);
      if (!wm) { wm = new Map(); byQueueWeek.set(r.queue, wm); }
      (wm.get(r.week) ?? wm.set(r.week, []).get(r.week)!).push(r);
    }
    if (r.isExcluded) continue;
    if (ex.size && ex.has((r.ticket || "").trim().toLowerCase())) continue;
    clean.push(r);
    if (r.month && r.month !== "unknown") {
      (byMonth.get(r.month) ?? byMonth.set(r.month, []).get(r.month)!).push(r);
    }
    if (r.week && r.week !== "No week") {
      (byWeek.get(r.week) ?? byWeek.set(r.week, []).get(r.week)!).push(r);
    }
    const q = r.queue || "Unknown";
    (byQueue.get(q) ?? byQueue.set(q, []).get(q)!).push(r);
  }

  entry = { exclSet: ex, clean, all, byMonth, byWeek, byQueue, byQueueWeek, allByMonth };
  perDs.set(code, entry);
  return entry;
}

function point(label: string, arr: SlaRow[], code: KpiCode): PeriodPoint {
  const meta = KPI_META[code];
  const total = arr.length;
  let breaches = 0;
  for (const r of arr) if (r.isBreach) breaches++;
  const t = calcTarget(total, breaches, meta);
  return { label, total, breaches, rate: t.value, rag: t.rag };
}

/* ───────────────────────── public API ───────────────────────── */

export function monthlySummary(ds: Dataset, code: KpiCode): PeriodPoint[] {
  const c = cacheFor(ds, code);
  return [...c.byMonth.keys()].sort().map((m) => point(m, c.byMonth.get(m)!, code));
}

export function weeklySummary(ds: Dataset, code: KpiCode, opts?: { queue?: string; lastN?: number }): PeriodPoint[] {
  const c = cacheFor(ds, code);
  let weeksMap: Map<string, SlaRow[]>;
  if (opts?.queue) {
    weeksMap = new Map();
    const rows = c.byQueue.get(opts.queue) ?? [];
    for (const r of rows) if (r.week && r.week !== "No week") {
      (weeksMap.get(r.week) ?? weeksMap.set(r.week, []).get(r.week)!).push(r);
    }
  } else {
    weeksMap = c.byWeek;
  }
  const weeks = [...weeksMap.keys()].sort().slice(-(opts?.lastN ?? WEEKLY_WINDOW));
  return weeks.map((w) => point(w, weeksMap.get(w)!, code));
}

export function overallByKpi(ds: Dataset, code: KpiCode, month?: string | null) {
  const c = cacheFor(ds, code);
  const rows = month ? (c.byMonth.get(month) ?? []) : c.clean;
  const meta = KPI_META[code];
  let breaches = 0;
  for (const r of rows) if (r.isBreach) breaches++;
  const t = calcTarget(rows.length, breaches, meta);
  return { total: rows.length, breaches, ...t };
}

export function rawOverallByKpi(ds: Dataset, code: KpiCode, month?: string | null) {
  const c = cacheFor(ds, code);
  const rows = month ? (c.allByMonth.get(month) ?? []) : c.all;
  const meta = KPI_META[code];
  let breaches = 0;
  for (const r of rows) if (r.isBreach) breaches++;
  const t = calcTarget(rows.length, breaches, meta);
  return { total: rows.length, breaches, ...t };
}

export function queueBreakdown(ds: Dataset, code: KpiCode, month?: string | null) {
  const c = cacheFor(ds, code);
  const meta = KPI_META[code];
  const grouped = new Map<string, SlaRow[]>();
  const source = month ? (c.byMonth.get(month) ?? []) : c.clean;
  if (month) {
    for (const r of source) {
      const q = r.queue || "Unknown";
      (grouped.get(q) ?? grouped.set(q, []).get(q)!).push(r);
    }
  } else {
    // reuse pre-grouped
    c.byQueue.forEach((v, k) => grouped.set(k, v));
  }
  const out: Array<{ queue: string; total: number; breaches: number; rate: number; rag: PeriodPoint["rag"]; display: string }> = [];
  grouped.forEach((arr, queue) => {
    let breaches = 0;
    for (const r of arr) if (r.isBreach) breaches++;
    const t = calcTarget(arr.length, breaches, meta);
    out.push({ queue, total: arr.length, breaches, rate: t.value, rag: t.rag, display: t.display });
  });
  return out.sort((a, b) => b.total - a.total);
}

export function weeklyQueueSummary(ds: Dataset, code: KpiCode, queue: string, opts?: { lastN?: number; raw?: boolean }): PeriodPoint[] {
  const c = cacheFor(ds, code);
  let weeksMap: Map<string, SlaRow[]>;
  if (opts?.raw) {
    weeksMap = c.byQueueWeek.get(queue) ?? new Map();
  } else {
    weeksMap = new Map();
    const rows = c.byQueue.get(queue) ?? [];
    for (const r of rows) if (r.week && r.week !== "No week") {
      (weeksMap.get(r.week) ?? weeksMap.set(r.week, []).get(r.week)!).push(r);
    }
  }
  const weeks = [...weeksMap.keys()].sort().slice(-(opts?.lastN ?? WEEKLY_WINDOW));
  return weeks.map((w) => point(w, weeksMap.get(w)!, code));
}

export function exclusionImpact(ds: Dataset, code: KpiCode, month?: string | null) {
  const c = cacheFor(ds, code);
  const meta = KPI_META[code];
  const allScoped = month ? (c.allByMonth.get(month) ?? []) : c.all;
  const adjScoped = month ? (c.byMonth.get(month) ?? []) : c.clean;
  let rawBreaches = 0; for (const r of allScoped) if (r.isBreach) rawBreaches++;
  let adjBreaches = 0; for (const r of adjScoped) if (r.isBreach) adjBreaches++;
  const rawTotal = allScoped.length;
  const adjTotal = adjScoped.length;
  const raw = calcTarget(rawTotal, rawBreaches, meta);
  const adj = calcTarget(adjTotal, adjBreaches, meta);
  return { rawTotal, rawBreaches, adjTotal, adjBreaches, excluded: rawTotal - adjTotal, raw, adj };
}

export function monthLabel(m: string): string {
  if (!m) return "All";
  const parts = m.split("-");
  if (parts.length === 2) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return (months[parseInt(parts[1], 10) - 1] || parts[1]) + " " + parts[0];
  }
  return m;
}

export function weekLabel(w: string): string {
  if (!w || w === "No week") return "—";
  const m = w.match(/^(\d{4})-W(\d{2})$/);
  return m ? `W${parseInt(m[2], 10)} '${m[1].slice(2)}` : w;
}
