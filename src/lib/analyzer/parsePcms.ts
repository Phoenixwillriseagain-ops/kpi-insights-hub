import * as XLSX from "xlsx";
import { PCMS_CATEGORIES, type PcmsRow } from "./pcmsAnalytics";

// Re-export pure surface so existing imports keep working.
export { PCMS_CATEGORIES, pcmsByCategory, pcmsTopAgents, pcmsWeeklyCounts } from "./pcmsAnalytics";
export type { PcmsRow } from "./pcmsAnalytics";

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
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

