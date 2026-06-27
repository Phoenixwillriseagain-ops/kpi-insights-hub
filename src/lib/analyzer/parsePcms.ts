import * as XLSX from "xlsx";

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

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export type PcmsRow = {
  ticket: string;
  weekNum: number | null;     // 1..53
  weekKey: string;            // "YYYY-Www" (year inferred or empty)
  monthNum: number | null;    // 1..12
  monthKey: string;           // "YYYY-MM"
  monthName: string;
  reason: string;
  category: number;           // 0 if unknown
  categoryLabel: string;
  agent: string;
  bmsId: string;
  status: string;             // KO | NOK | other
};

function makeCol(row: Record<string, unknown>) {
  const keys = Object.keys(row);
  return (...names: string[]) => {
    for (const n of names) {
      const target = n.replace(/[\s_-]/g, "").toLowerCase();
      for (const k of keys) {
        if (k.replace(/[\s_-]/g, "").toLowerCase() === target) return row[k];
      }
    }
    return "";
  };
}

function parseCategory(reason: string): { id: number; label: string } {
  const m = String(reason || "").match(/^\s*(\d{1,2})\b/);
  if (!m) return { id: 0, label: "Uncategorized" };
  const id = parseInt(m[1], 10);
  const cat = PCMS_CATEGORIES.find((c) => c.id === id);
  return { id, label: cat?.label ?? `#${id}` };
}

function monthToNum(v: unknown): { num: number | null; name: string } {
  if (v == null || v === "") return { num: null, name: "" };
  if (v instanceof Date && !isNaN(v.getTime())) {
    return { num: v.getMonth() + 1, name: v.toLocaleString("en", { month: "long" }) };
  }
  if (typeof v === "number") {
    // Excel serial
    const d = new Date(Math.round((v - 25569) * 86400000));
    if (!isNaN(d.getTime())) return { num: d.getMonth() + 1, name: d.toLocaleString("en", { month: "long" }) };
  }
  const s = String(v).trim().toLowerCase();
  if (MONTH_MAP[s]) {
    const num = MONTH_MAP[s];
    return { num, name: s[0].toUpperCase() + s.slice(1) };
  }
  return { num: null, name: String(v) };
}

export function parsePcms(wb: XLSX.WorkBook, inferYear: number | null): PcmsRow[] {
  // Prefer Overall sheet; fall back to Summary
  const sheetName =
    wb.SheetNames.find((s) => s.toLowerCase() === "overall") ??
    wb.SheetNames.find((s) => s.toLowerCase() === "summary") ??
    wb.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
  const out: PcmsRow[] = [];
  rows.forEach((r) => {
    const col = makeCol(r);
    const ticket = String(col("TicketID", "Ticket", "TicketNumber", "IncidentTicket") || "").trim();
    if (!ticket || !/^INC|^[0-9A-Z]/i.test(ticket)) return;
    const reasonRaw = String(col("Reason") || "").trim();
    if (!reasonRaw) return;
    const cat = parseCategory(reasonRaw);
    const wRaw = col("Week");
    const weekNum = (() => {
      if (typeof wRaw === "number" && isFinite(wRaw)) return Math.trunc(wRaw);
      const m = String(wRaw).match(/(\d{1,2})/);
      return m ? parseInt(m[1], 10) : null;
    })();
    const { num: monthNum, name: monthName } = monthToNum(col("Month"));
    const year = inferYear ?? new Date().getFullYear();
    const weekKey = weekNum ? `${year}-W${String(weekNum).padStart(2, "0")}` : "";
    const monthKey = monthNum ? `${year}-${String(monthNum).padStart(2, "0")}` : "";
    out.push({
      ticket,
      weekNum,
      weekKey,
      monthNum,
      monthKey,
      monthName,
      reason: reasonRaw,
      category: cat.id,
      categoryLabel: cat.label,
      agent: String(col("Agent") || "").trim(),
      bmsId: String(col("BMSID", "BMS_ID") || "").trim(),
      status: String(col("NOK/KO", "NOKKO", "Status") || "").trim().toUpperCase(),
    });
  });
  return out;
}

/* Selectors ---------------------------------------------------------------- */

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
