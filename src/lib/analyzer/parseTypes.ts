// Pure (no xlsx) types & selectors. Safe to import from the main bundle.
import type { KpiCode } from "./kpi";
import type { PcmsRow } from "./pcmsAnalytics";

export type SlaRow = {
  ticket: string;
  month: string; // "YYYY-MM" or "unknown"
  week: string; // "YYYY-Www" or "No week"
  queue: string;
  language: string;
  isBreach: boolean;
  isExcluded: boolean;
};

export type BreachRow = {
  ticket: string;
  week: string;
  month: string;
  queue: string;
  agent: string;
  reason: string;
  aos: string;
  comment: string;
};

export type ExclRow = {
  ticket: string;
  reason: string;
  comment: string;
  jira: string;
  date: string;
  priority: string;
};

export type Dataset = {
  sla: Partial<Record<KpiCode, SlaRow[]>>;
  breach: Partial<Record<KpiCode, BreachRow[]>>;
  excl: Partial<Record<KpiCode, ExclRow[]>>;
  pcms: PcmsRow[];
  months: string[];
  weeks: string[];
};

const exclSetCache = new WeakMap<Dataset, Map<KpiCode, Set<string>>>();

export function exclSet(ds: Dataset, code: KpiCode): Set<string> {
  let perDs = exclSetCache.get(ds);
  if (!perDs) {
    perDs = new Map();
    exclSetCache.set(ds, perDs);
  }
  let entry = perDs.get(code);
  if (entry) return entry;

  const s = new Set<string>();
  (ds.excl[code] ?? []).forEach((r) => r.ticket && s.add(r.ticket.trim().toLowerCase()));
  perDs.set(code, s);
  return s;
}

export function filteredRows(ds: Dataset, code: KpiCode, month?: string | null): SlaRow[] {
  const ex = exclSet(ds, code);
  let rows = (ds.sla[code] ?? []).filter((r) => {
    if (r.isExcluded) return false;
    if (ex.size && ex.has(r.ticket.trim().toLowerCase())) return false;
    return true;
  });
  if (month) rows = rows.filter((r) => r.month === month);
  return rows;
}

export function rawRows(ds: Dataset, code: KpiCode, month?: string | null): SlaRow[] {
  let rows = (ds.sla[code] ?? []).filter((r) => !r.isExcluded);
  if (month) rows = rows.filter((r) => r.month === month);
  return rows;
}
