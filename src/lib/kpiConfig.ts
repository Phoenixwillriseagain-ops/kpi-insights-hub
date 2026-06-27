export type KpiDef = {
  code: string;
  label: string;
  target: number; // 0-1
  watchBand?: number; // points below target still "watch" (default 0.03)
  measures: string;
  targetText: string;
};

export const KPIS: KpiDef[] = [
  { code: "KSL-1", label: "Dealer Satisfaction Rating L1", target: 0.9, measures: "KSL-1 · Dealer Satisfaction Rating L1", targetText: "KSL -1 Rating L1 (4.00)" },
  { code: "KSL-2a", label: "Handling Time Low ≤180min", target: 0.9, measures: "KSL-2a · Handling Time Low ≤180min", targetText: "KSL - 2a Low ≤180min (≥90%)" },
  { code: "KSL-2b", label: "Handling Time Low ≤300min", target: 0.95, measures: "KSL-2b · Handling Time Low ≤300min", targetText: "KSL - 2b Low ≤300min (≥95%)" },
  { code: "KSL-2c", label: "Handling Time Medium ≤150min", target: 0.9, measures: "KSL-2c · Handling Time Medium ≤150min", targetText: "KSL - 2c Medium ≤150min (≥90%)" },
  { code: "KSL-2d", label: "Handling Time Medium ≤180min", target: 0.95, measures: "KSL-2d · Handling Time Medium ≤180min", targetText: "KSL - 2d Medium ≤180min (≥95%)" },
  { code: "KSL-3a", label: "Reaction Time Ticket ≤30min", target: 0.9, measures: "KSL-3a · Reaction Time Ticket ≤30min", targetText: "KSL - 3a Ticket ≤30min (≥90%)" },
  { code: "KSL-4", label: "Solution Quality w/o Related Incident", target: 0.9, measures: "KSL-4 · Solution Quality w/o Related Incident", targetText: "KSL - 4 (≥90%)" },
  { code: "KSL-5a", label: "Process Conformity Automatic", target: 0.9, measures: "KSL-5a · Process Conformity Automatic", targetText: "KSL - 5a (≥90%)" },
  { code: "KSL-5b", label: "Process Conformity Manual", target: 0.9, measures: "KSL-5b · Process Conformity Manual", targetText: "KSL - 5b (≥90%)" },
  { code: "KSL-6", label: "Linking to Compass", target: 0.95, measures: "KSL-6 · Linking to Compass", targetText: "KSL - 6 (≥95%)" },
  // KM KPIs are "lower is better" — invert: compliance = 1 - breachRate, target is upper bound for breach rate
  { code: "KM-1", label: "With Reopen", target: 0.95, measures: "KM-1 · With Reopen", targetText: "KM - 1 (lower is better)" },
  { code: "KM-2", label: "With Assigned Back", target: 0.95, measures: "KM-2 · With Assigned Back", targetText: "KM - 2 (lower is better)" },
];

export const LOWER_IS_BETTER = new Set(["KM-1", "KM-2"]);

export function statusFor(kpi: KpiDef, rate: number): "good" | "watch" | "risk" {
  const watchBand = kpi.watchBand ?? 0.03;
  if (LOWER_IS_BETTER.has(kpi.code)) {
    // For KM, "rate" passed in is the breach rate displayed; treat as good if low
    // but the dashboard shows breach % directly for KM. We compare against (1 - target) as ceiling.
    const ceiling = 1 - kpi.target;
    if (rate <= ceiling) return "good";
    if (rate <= ceiling + watchBand) return "watch";
    return "risk";
  }
  if (rate >= kpi.target) return "good";
  if (rate >= kpi.target - watchBand) return "watch";
  return "risk";
}
