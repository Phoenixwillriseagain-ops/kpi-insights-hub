import { KPI_META, calcTarget, type KpiCode } from "./kpi";
import { exclSet, filteredRows, type Dataset, type SlaRow } from "./parse";

export type PeriodPoint = {
  label: string;
  total: number;
  breaches: number;
  rate: number;
  rag: "green" | "amber" | "red" | "none";
};

export const WEEKLY_WINDOW = 6;

export function monthlySummary(ds: Dataset, code: KpiCode): PeriodPoint[] {
  const meta = KPI_META[code];
  const ex = exclSet(ds, code);
  const rows = (ds.sla[code] ?? []).filter((r) => {
    if (r.isExcluded) return false;
    if (ex.size && ex.has(r.ticket.trim().toLowerCase())) return false;
    return true;
  });
  const grouped: Record<string, SlaRow[]> = {};
  rows.forEach((r) => {
    if (!r.month || r.month === "unknown") return;
    (grouped[r.month] ??= []).push(r);
  });
  return Object.keys(grouped).sort().map((m) => {
    const arr = grouped[m];
    const total = arr.length;
    const breaches = arr.filter((r) => r.isBreach).length;
    const t = calcTarget(total, breaches, meta);
    return { label: m, total, breaches, rate: t.value, rag: t.rag };
  });
}

export function weeklySummary(ds: Dataset, code: KpiCode, opts?: { queue?: string; lastN?: number }): PeriodPoint[] {
  const meta = KPI_META[code];
  const ex = exclSet(ds, code);
  let rows = (ds.sla[code] ?? []).filter((r) => {
    if (r.isExcluded) return false;
    if (ex.size && ex.has(r.ticket.trim().toLowerCase())) return false;
    return r.week && r.week !== "No week";
  });
  if (opts?.queue) rows = rows.filter((r) => r.queue === opts.queue);
  const grouped: Record<string, SlaRow[]> = {};
  rows.forEach((r) => { (grouped[r.week] ??= []).push(r); });
  const weeks = Object.keys(grouped).sort().slice(-(opts?.lastN ?? WEEKLY_WINDOW));
  return weeks.map((w) => {
    const arr = grouped[w];
    const total = arr.length;
    const breaches = arr.filter((r) => r.isBreach).length;
    const t = calcTarget(total, breaches, meta);
    return { label: w, total, breaches, rate: t.value, rag: t.rag };
  });
}

export function overallByKpi(ds: Dataset, code: KpiCode, month?: string | null) {
  const rows = filteredRows(ds, code, month);
  const total = rows.length;
  const breaches = rows.filter((r) => r.isBreach).length;
  const meta = KPI_META[code];
  const t = calcTarget(total, breaches, meta);
  return { total, breaches, ...t };
}

export function rawOverallByKpi(ds: Dataset, code: KpiCode, month?: string | null) {
  const rows = (ds.sla[code] ?? []).filter((r) => !r.isExcluded);
  const scoped = month ? rows.filter((r) => r.month === month) : rows;
  const total = scoped.length;
  const breaches = scoped.filter((r) => r.isBreach).length;
  const meta = KPI_META[code];
  const t = calcTarget(total, breaches, meta);
  return { total, breaches, ...t };
}

export function queueBreakdown(ds: Dataset, code: KpiCode, month?: string | null) {
  const rows = filteredRows(ds, code, month);
  const meta = KPI_META[code];
  const grouped: Record<string, SlaRow[]> = {};
  rows.forEach((r) => { (grouped[r.queue || "Unknown"] ??= []).push(r); });
  return Object.entries(grouped).map(([queue, arr]) => {
    const total = arr.length;
    const breaches = arr.filter((r) => r.isBreach).length;
    const t = calcTarget(total, breaches, meta);
    return { queue, total, breaches, rate: t.value, rag: t.rag, display: t.display };
  }).sort((a, b) => b.total - a.total);
}

export function exclusionImpact(ds: Dataset, code: KpiCode, month?: string | null) {
  const meta = KPI_META[code];
  const allRows = (ds.sla[code] ?? []).filter((r) => !r.isExcluded);
  const scoped = month ? allRows.filter((r) => r.month === month) : allRows;
  const ex = exclSet(ds, code);
  const adjusted = scoped.filter((r) => !ex.has(r.ticket.trim().toLowerCase()));
  const rawTotal = scoped.length;
  const rawBreaches = scoped.filter((r) => r.isBreach).length;
  const adjTotal = adjusted.length;
  const adjBreaches = adjusted.filter((r) => r.isBreach).length;
  const excluded = rawTotal - adjTotal;
  const raw = calcTarget(rawTotal, rawBreaches, meta);
  const adj = calcTarget(adjTotal, adjBreaches, meta);
  return { rawTotal, rawBreaches, adjTotal, adjBreaches, excluded, raw, adj };
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
