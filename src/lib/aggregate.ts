import { KPIS, LOWER_IS_BETTER, type KpiDef } from "./kpiConfig";
import type { ParsedWorkbook, TicketRow } from "./parseWorkbook";

export type KpiAgg = { tickets: number; breaches: number; rate: number };

function rateFor(code: string, tickets: number, breaches: number): number {
  if (tickets === 0) return 0;
  if (LOWER_IS_BETTER.has(code)) return breaches / tickets; // displayed as breach %
  return (tickets - breaches) / tickets; // compliance %
}

export function aggregateRows(rows: TicketRow[]): Record<string, KpiAgg> {
  const out: Record<string, KpiAgg> = {};
  for (const k of KPIS) out[k.code] = { tickets: 0, breaches: 0, rate: 0 };
  for (const r of rows) {
    for (const k of KPIS) {
      const cell = r.kpi[k.code];
      if (!cell || !cell.applicable) continue;
      out[k.code].tickets += 1;
      if (cell.breach) out[k.code].breaches += 1;
    }
  }
  for (const k of KPIS) out[k.code].rate = rateFor(k.code, out[k.code].tickets, out[k.code].breaches);
  return out;
}

export function overallByKpi(wb: ParsedWorkbook) {
  return aggregateRows(wb.rows);
}

// Returns last `n` weeks (ascending) with per-week aggregation for a single KPI.
export function trendByKpi(wb: ParsedWorkbook, kpi: KpiDef, n = 6) {
  const weeks = wb.weeks.slice(-n);
  const byWeek = new Map<string, TicketRow[]>();
  for (const w of weeks) byWeek.set(w, []);
  for (const r of wb.rows) {
    if (byWeek.has(r.weekKey)) byWeek.get(r.weekKey)!.push(r);
  }
  return weeks.map((w) => {
    const agg = aggregateRows(byWeek.get(w) ?? [])[kpi.code];
    return {
      weekKey: w,
      weekLabel: wb.weekLabels[w] ?? w,
      tickets: agg.tickets,
      breaches: agg.breaches,
      rate: agg.rate,
    };
  });
}

export function byQueue(wb: ParsedWorkbook) {
  const groups = new Map<string, TicketRow[]>();
  for (const r of wb.rows) {
    const k = r.queue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const result: { queue: string; market: string; agg: Record<string, KpiAgg> }[] = [];
  for (const [queue, rows] of groups) {
    result.push({ queue, market: rows[0]?.market ?? "", agg: aggregateRows(rows) });
  }
  return result.sort((a, b) => a.queue.localeCompare(b.queue));
}

export function byMarket(wb: ParsedWorkbook) {
  const groups = new Map<string, TicketRow[]>();
  for (const r of wb.rows) {
    const k = r.market || "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  return Array.from(groups.entries())
    .map(([market, rows]) => ({ market, agg: aggregateRows(rows), queues: new Set(rows.map((r) => r.queue)).size }))
    .sort((a, b) => a.market.localeCompare(b.market));
}

export function filterRows(wb: ParsedWorkbook, opts: { market?: string; queue?: string }): ParsedWorkbook {
  const rows = wb.rows.filter((r) =>
    (!opts.market || r.market === opts.market) && (!opts.queue || r.queue === opts.queue)
  );
  return { ...wb, rows };
}
