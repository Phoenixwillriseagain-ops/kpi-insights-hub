export type KpiFamily = "KSL" | "KM";

export type KpiDef = {
  code: string;
  label: string;
  family: KpiFamily;
  target: number; // 0-1
  watchBand?: number; // default 0.03
  measures: string;
  targetText: string;
};

export const KPIS: KpiDef[] = [
  { code: "KSL-1", family: "KSL", label: "Dealer Satisfaction Rating L1", target: 0.9, measures: "KSL-1 · Dealer Satisfaction Rating L1", targetText: "≥ 90%" },
  { code: "KSL-2a", family: "KSL", label: "Handling Time Low ≤180min", target: 0.9, measures: "KSL-2a · Handling Time Low ≤180min", targetText: "≥ 90%" },
  { code: "KSL-2b", family: "KSL", label: "Handling Time Low ≤300min", target: 0.95, measures: "KSL-2b · Handling Time Low ≤300min", targetText: "≥ 95%" },
  { code: "KSL-2c", family: "KSL", label: "Handling Time Medium ≤150min", target: 0.9, measures: "KSL-2c · Handling Time Medium ≤150min", targetText: "≥ 90%" },
  { code: "KSL-2d", family: "KSL", label: "Handling Time Medium ≤210min", target: 0.95, measures: "KSL-2d · Handling Time Medium ≤210min", targetText: "≥ 95%" },
  { code: "KSL-3a", family: "KSL", label: "Reaction Time Ticket ≤30min", target: 0.9, measures: "KSL-3a · Reaction Time Ticket ≤30min", targetText: "≥ 90%" },
  { code: "KSL-4", family: "KSL", label: "Solution Quality w/o Related Incident", target: 0.9, measures: "KSL-4 · Solution Quality w/o Related Incident", targetText: "≥ 90%" },
  { code: "KSL-5a", family: "KSL", label: "Process Conformity Automatic", target: 0.9, measures: "KSL-5a · Process Conformity Automatic", targetText: "≥ 90%" },
  { code: "KSL-5b", family: "KSL", label: "Process Conformity Manual", target: 0.9, measures: "KSL-5b · Process Conformity Manual", targetText: "≥ 90%" },
  { code: "KSL-6", family: "KSL", label: "Linking to Compass", target: 0.95, measures: "KSL-6 · Linking to Compass", targetText: "≥ 95%" },
  { code: "KM-1", family: "KM", label: "With Reopen", target: 0.05, measures: "KM-1 · With Reopen", targetText: "≤ 5%" },
  { code: "KM-2", family: "KM", label: "With Assigned Back", target: 0.05, measures: "KM-2 · With Assigned Back", targetText: "≤ 5%" },
];

export const KPI_BY_CODE: Record<string, KpiDef> = Object.fromEntries(KPIS.map((k) => [k.code, k]));

export function isLowerBetter(kpi: KpiDef): boolean {
  return kpi.family === "KM";
}

/**
 * Compute KPI percentage from total/breach counts.
 * KSL → (total - breach) / total. KM → breach / total.
 */
export function kpiPct(kpi: KpiDef, total: number, breach: number): number {
  if (total === 0) return 0;
  if (isLowerBetter(kpi)) return breach / total;
  return (total - breach) / total;
}

export function statusFor(kpi: KpiDef, pct: number): "good" | "watch" | "risk" {
  const watchBand = kpi.watchBand ?? 0.03;
  if (isLowerBetter(kpi)) {
    if (pct <= kpi.target) return "good";
    if (pct <= kpi.target + watchBand) return "watch";
    return "risk";
  }
  if (pct >= kpi.target) return "good";
  if (pct >= kpi.target - watchBand) return "watch";
  return "risk";
}

export function formatPct(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}
