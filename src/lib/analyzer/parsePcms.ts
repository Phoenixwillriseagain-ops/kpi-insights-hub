import * as XLSX from "xlsx";
import type { PcmsRow } from "./parseTypes";

function makeCol(row: Record<string, unknown>) {
  const keys = Object.keys(row);
  return (...names: string[]) => {
    for (const n of names) {
      const target = n.replace(/[\s_\-/.()]/g, "").toLowerCase();
      for (const k of keys) {
        if (k.replace(/[\s_\-/.()]/g, "").toLowerCase() === target) return row[k];
      }
    }
    return "";
  };
}

function monthToNum(v: unknown): { num: number | null; name: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { num: null, name: "" };

  const names: Record<string, number> = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };

  const lower = raw.toLowerCase();
  if (names[lower]) return { num: names[lower], name: raw };

  const m1 = lower.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/);
  if (m1) return { num: names[m1[1]], name: raw };

  const m2 = lower.match(/\b(1[0-2]|0?[1-9])\b/);
  if (m2) return { num: parseInt(m2[1], 10), name: raw };

  return { num: null, name: raw };
}

function parseWeek(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const n = Math.trunc(v);
    return n >= 1 && n <= 53 ? n : null;
  }

  const s = String(v ?? "").trim();
  if (!s) return null;

  const iso = s.match(/\bW?(\d{1,2})\b/i);
  if (!iso) return null;

  const n = parseInt(iso[1], 10);
  return n >= 1 && n <= 53 ? n : null;
}

function normalizeStatus(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return "";
  if (s.includes("NOK")) return "NOK";
  if (s === "KO" || s.includes(" KO") || s.startsWith("KO ")) return "KO";
  return s;
}

function parseCategory(reasonRaw: string): { id: number; label: string } {
  const r = reasonRaw.trim().toLowerCase();

  if (r.startsWith("1") || r.includes("agent") || r.includes("human error")) return { id: 1, label: "Agent / human error" };
  if (r.startsWith("2") || r.includes("process")) return { id: 2, label: "Process gap" };
  if (r.startsWith("3") || r.includes("tool") || r.includes("system")) return { id: 3, label: "Tool / system issue" };
  if (r.startsWith("4") || r.includes("customer")) return { id: 4, label: "Customer dependency" };
  if (r.startsWith("5") || r.includes("external")) return { id: 5, label: "External dependency" };
  if (r.startsWith("6") || r.includes("training") || r.includes("knowledge")) return { id: 6, label: "Training / knowledge gap" };
  return { id: 7, label: "Other" };
}

function scoreSheet(name: string) {
  const s = name.toLowerCase();
  let score = 0;
  if (s === "overall") score += 100;
  if (s === "summary") score += 90;
  if (s.includes("pcm")) score += 80;
  if (s.includes("ksl-5b") || s.includes("ksl5b")) score += 70;
  if (s.includes("deep")) score += 40;
  return score;
}

export function parsePcms(wb: XLSX.WorkBook, inferYear: number | null): PcmsRow[] {
  const sortedSheets = [...wb.SheetNames].sort((a, b) => scoreSheet(b) - scoreSheet(a));
  const year = inferYear ?? new Date().getFullYear();
  const out: PcmsRow[] = [];

  for (const sheetName of sortedSheets) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) continue;

    rows.forEach((r, index) => {
      const col = makeCol(r);

      const ticket = String(
        col(
          "TicketID", "Ticket", "TicketNumber", "IncidentTicket",
          "CaseID", "Case", "ID", "Incident", "Reference"
        ) ?? ""
      ).trim();

      const reasonRaw = String(
        col(
          "Reason", "Reason Category", "KO Reason", "NOK Reason",
          "Category", "Root Cause", "Description", "Comment", "Comments",
          "Failure Reason", "Driver"
        ) ?? ""
      ).trim();

      const status = normalizeStatus(
        col("NOK/KO", "NOKKO", "Status", "Result", "Outcome", "KO/NOK")
      );

      const agent = String(
        col("Agent", "AgentName", "Agent Name", "Owner", "Assigned To", "Resolver")
      ).trim();

      const bmsId = String(
        col("BMSID", "BMS_ID", "BMS ID", "EmployeeID", "Employee ID", "CEC ID")
      ).trim();

      const weekNum = parseWeek(
        col("Week", "WeekNumber", "Week Number", "WK", "ISO Week", "Reporting Week")
      );

      const { num: monthNum, name: monthName } = monthToNum(
        col("Month", "MonthName", "Month Name", "Period", "Reporting Month")
      );

      const hasSignal = !!(ticket || reasonRaw || status || agent || bmsId);
      if (!hasSignal) return;

      const cat = parseCategory(reasonRaw || "Other");
      const weekKey = weekNum ? `${year}-W${String(weekNum).padStart(2, "0")}` : "";
      const monthKey = monthNum ? `${year}-${String(monthNum).padStart(2, "0")}` : "";

      out.push({
        ticket: ticket || `__pcms_row_${sheetName}_${index}`,
        weekNum,
        weekKey,
        monthNum,
        monthKey,
        monthName,
        reason: reasonRaw || "Unspecified",
        category: cat.id,
        categoryLabel: cat.label,
        agent,
        bmsId,
        status,
      });
    });

    if (out.length > 0) break;
  }

  return out;
}
