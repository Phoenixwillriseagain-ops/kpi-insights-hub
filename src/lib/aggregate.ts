import { KPI_BY_CODE, kpiPct, type KpiDef } from "./kpiConfig";
import type { KpiRecord, ParsedWorkbook } from "./parseWorkbook";

export type Side = { total: number; breach: number; pct: number };
export type BeforeAfter = { before: Side; after: Side };

function emptySide(): Side {
  return { total: 0, breach: 0, pct: 0 };
}

function finalize(kpi: KpiDef, s: Side): Side {
  s.pct = kpiPct(kpi, s.total, s.breach);
  return s;
}

export type Filter = {
  kpiCode?: string;
  weekKey?: string;
  queue?: string;
  market?: string;
};

function matches(r: KpiRecord, f: Filter): boolean {
  if (f.kpiCode && r.kpiCode !== f.kpiCode) return false;
  if (f.weekKey && r.weekKey !== f.weekKey) return false;
  if (f.queue && r.queue !== f.queue) return false;
  if (f.market && r.market !== f.market) return false;
  return true;
}

export function aggregateKpi(
  records: KpiRecord[],
  kpiCode: string,
  filter: Omit<Filter, "kpiCode"> = {},
): BeforeAfter {
  const kpi = KPI_BY_CODE[kpiCode];
  const before = emptySide();
  const after = emptySide();
  for (const r of records) {
    if (r.kpiCode !== kpiCode) continue;
    if (!matches(r, { ...filter, kpiCode })) continue;
    before.total += 1;
    if (r.breach) before.breach += 1;
    if (!r.excluded) {
      after.total += 1;
      if (r.breach) after.breach += 1;
    }
  }
  return { before: finalize(kpi, before), after: finalize(kpi, after) };
}

export function overallByKpi(wb: ParsedWorkbook): Record<string, BeforeAfter> {
  const out: Record<string, BeforeAfter> = {};
  for (const code of Object.keys(KPI_BY_CODE)) {
    out[code] = aggregateKpi(wb.records, code);
  }
  return out;
}

export type TrendPoint = {
  weekKey: string;
  weekLabel: string;
  before: Side;
  after: Side;
};

export function kpiTrend(wb: ParsedWorkbook, kpiCode: string, lastN = 6, extraFilter: Omit<Filter, "kpiCode" | "weekKey"> = {}): TrendPoint[] {
  const kpi = KPI_BY_CODE[kpiCode];
  const weeksInKpi = new Set<string>();
  for (const r of wb.records) if (r.kpiCode === kpiCode) weeksInKpi.add(r.weekKey);
  const weeks = Array.from(weeksInKpi).sort().slice(-lastN);
  return weeks.map((weekKey) => {
    const ba = aggregateKpi(wb.records, kpiCode, { ...extraFilter, weekKey });
    return {
      weekKey,
      weekLabel: wb.weekLabels[weekKey] ?? weekKey,
      before: finalize(kpi, ba.before),
      after: finalize(kpi, ba.after),
    };
  });
}

export function marketBreakdown(wb: ParsedWorkbook, kpiCode: string): Array<{ market: string; ba: BeforeAfter; queueCount: number }> {
  const byMarket = new Map<string, KpiRecord[]>();
  for (const r of wb.records) {
    if (r.kpiCode !== kpiCode) continue;
    const key = r.market || "—";
    if (!byMarket.has(key)) byMarket.set(key, []);
    byMarket.get(key)!.push(r);
  }
  return Array.from(byMarket.entries())
    .map(([market, rows]) => ({
      market,
      ba: aggregateKpi(rows, kpiCode),
      queueCount: new Set(rows.map((r) => r.queue)).size,
    }))
    .sort((a, b) => a.market.localeCompare(b.market));
}

export function queueBreakdown(wb: ParsedWorkbook, kpiCode: string, market?: string): Array<{ queue: string; market: string; ba: BeforeAfter }> {
  const byQueue = new Map<string, KpiRecord[]>();
  for (const r of wb.records) {
    if (r.kpiCode !== kpiCode) continue;
    if (market && r.market !== market) continue;
    if (!byQueue.has(r.queue)) byQueue.set(r.queue, []);
    byQueue.get(r.queue)!.push(r);
  }
  return Array.from(byQueue.entries())
    .map(([queue, rows]) => ({ queue, market: rows[0]?.market ?? "", ba: aggregateKpi(rows, kpiCode) }))
    .sort((a, b) => a.queue.localeCompare(b.queue));
}

/**
 * Per-queue breakdown across ALL KPIs (returns one row per queue with map of KPI -> BeforeAfter).
 */
export function queueMatrix(wb: ParsedWorkbook, market?: string): Array<{ queue: string; market: string; kpis: Record<string, BeforeAfter> }> {
  const queues = new Set<string>();
  const queueMarket = new Map<string, string>();
  for (const r of wb.records) {
    if (market && r.market !== market) continue;
    queues.add(r.queue);
    if (!queueMarket.has(r.queue)) queueMarket.set(r.queue, r.market);
  }
  return Array.from(queues)
    .sort()
    .map((queue) => {
      const kpis: Record<string, BeforeAfter> = {};
      for (const code of Object.keys(KPI_BY_CODE)) {
        kpis[code] = aggregateKpi(wb.records, code, { queue });
      }
      return { queue, market: queueMarket.get(queue) ?? "", kpis };
    });
}
