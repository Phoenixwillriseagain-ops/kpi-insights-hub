// Pure (no xlsx) PCms types, constants and selectors. Safe for the main bundle.

export const PCMS_CATEGORIES: { id: number; label: string; color: string }[] = [
  { id: 1,  label: "Valid Rejection",            color: "#0a9396" },
  { id: 2,  label: "Communication",              color: "#94d2bd" },
  { id: 3,  label: "COMPASS Solution",           color: "#005f73" },
  { id: 4,  label: "Linkage quality",            color: "#e9d8a6" },
  { id: 5,  label: "Related Incident",           color: "#ee9b00" },
  { id: 6,  label: "Translation",                color: "#ca6702" },
  { id: 7,  label: "Work Info Types",            color: "#bb3e03" },
  { id: 8,  label: "Documentation Traceability", color: "#ae2012" },
  { id: 9,  label: "Reasonable Ticket Processing", color: "#9b2226" },
  { id: 10, label: "Service Efficiency",         color: "#3a86ff" },
  { id: 11, label: "Other errors",               color: "#7b2cbf" },
];

export type PcmsRow = {
  ticket: string;
  weekNum: number | null;
  weekKey: string;
  monthNum: number | null;
  monthKey: string;
  monthName: string;
  reason: string;
  category: number;
  categoryLabel: string;
  agent: string;
  bmsId: string;
  status: string;
};

export function pcmsByCategory(rows: PcmsRow[], opts?: { byWeek?: boolean }) {
  const keyOf = (r: PcmsRow) => (opts?.byWeek ? r.weekKey || `W${r.weekNum ?? "?"}` : r.monthName || r.monthKey || "—");
  const grouped: Record<string, Record<string, number>> = {};
  rows.forEach((r) => {
    if (!r.category) return;
    const k = keyOf(r);
    grouped[k] ??= {};
    const cat = `cat_${r.category}`;
    grouped[k][cat] = (grouped[k][cat] ?? 0) + 1;
  });
  return Object.entries(grouped)
    .map(([label, cats]) => ({ label, ...cats, total: Object.values(cats).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function pcmsTopAgents(rows: PcmsRow[], n = 10) {
  const grouped: Record<string, { agent: string; count: number; ko: number; nok: number; byCat: Record<number, number> }> = {};
  rows.forEach((r) => {
    if (!r.agent) return;
    grouped[r.agent] ??= { agent: r.agent, count: 0, ko: 0, nok: 0, byCat: {} };
    grouped[r.agent].count += 1;
    if (r.status === "KO") grouped[r.agent].ko += 1;
    if (r.status === "NOK") grouped[r.agent].nok += 1;
    grouped[r.agent].byCat[r.category] = (grouped[r.agent].byCat[r.category] ?? 0) + 1;
  });
  return Object.values(grouped).sort((a, b) => b.count - a.count).slice(0, n);
}

export function pcmsWeeklyCounts(rows: PcmsRow[]) {
  const grouped: Record<string, number> = {};
  rows.forEach((r) => {
    if (!r.weekKey) return;
    grouped[r.weekKey] = (grouped[r.weekKey] ?? 0) + 1;
  });
  return Object.entries(grouped)
    .map(([weekKey, count]) => ({ weekKey, count }))
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey));
}
