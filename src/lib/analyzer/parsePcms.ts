import * as XLSX from "xlsx";
import type { PcmsRow } from "./parseTypes";

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

function monthToNum(v: unknown): { num: number | null; name: string } {
  const raw = String(v ?? "").trim();
  if (!raw) return { num: null, name: "" };

  const byName: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const lowered = raw.toLowerCase();
  if (byName[lowered]) return { num: byName[lowered], name: raw };

  const monthMatch = lowered.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/);
  if (monthMatch && byName[monthMatch[1]]) {
    return { num: byName[monthMatch[1]], name: raw };
  }

  const numeric = lowered.match(/\b(1[0-2]|0?[1-9])\b/);
  if (numeric) {
    const num = parseInt(numeric[1], 10);
    return { num, name: raw };
  }

  return { num: null, name: raw };
}

function parseCategory(reasonRaw: string): { id: number; label: string } {
  const r = reasonRaw.trim().toLowerCase();

  if (r.startsWith("1") || r.includes("agent") || r.includes("human error")) {
    return { id: 1, label: "Agent / human error" };
  }
  if (r.startsWith("2") || r.includes("process")) {
    return { id: 2, label: "Process gap" };
  }
  if (r.startsWith("3") || r.includes("tool") || r.includes("system")) {
    return { id: 3, label: "Tool / system issue" };
  }
  if (r.startsWith("4") || r.includes("customer")) {
    return { id: 4, label: "Customer dependency" };
  }
  if (r.startsWith("5") || r.includes("external")) {
    return { id: 5, label: "External dependency" };
  }
  if (r.startsWith("6") || r.includes("training") || r.includes("knowledge")) {
    return { id: 6, label: "Training / knowledge gap" };
  }
  if (r.startsWith("7") || r.includes("other")) {
    return { id: 7, label: "Other" };
  }

  return { id: 7, label: "Other" };
}

function normalizeStatus(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return "";
  if (s === "KO" || s.includes(" KO")) return "KO";
  if (s === "NOK" || s.includes("NOK")) return "NOK";
  return s;
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

export function parsePcms(wb: XLSX.WorkBook, inferYear: number | null): PcmsRow[] {
  const preferredSheets = ["overall", "summary", "pcms", "pcm", "ksl-5b", "ksl5b"];
  const lowered = wb.SheetNames.map((s) => ({ raw: s, low: s.trim().toLowerCase() }));

  const sheetName =
    preferredSheets
      .map((target) => lowered.find((s) => s.low === target)?.raw)
      .find(Boolean) ??
    lowered.find((s) => preferredSheets.some((p) => s.low.includes(p)))?.raw ??
    wb.SheetNames[0];

  if (!sheetName) return [];

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
  const out: PcmsRow[] = [];
  const year = inferYear ?? new Date().getFullYear();

  rows.forEach((r, index) => {
    const col = makeCol(r);

    const ticket = String(
      col(
        "TicketID",
        "Ticket",
        "TicketNumber",
        "IncidentTicket",
        "Ticket ID",
        "CaseID",
        "Case",
        "ID"
      ) ?? ""
    ).trim();

    if (!ticket) return;

    const reasonRaw = String(
      col(
        "Reason",
        "Reason Category",
        "KO Reason",
        "NOK Reason",
        "Category",
        "Root Cause",
        "Description",
        "Comment",
        "Comments"
      ) ?? ""
    ).trim();

    if (!reasonRaw) return;

    const cat = parseCategory(reasonRaw);

    const weekNum = parseWeek(
      col("Week", "WeekNumber", "Week Number", "WK", "ISO Week")
    );

    const { num: monthNum, name: monthName } = monthToNum(
      col("Month", "MonthName", "Month Name", "Period")
    );

    const weekKey = weekNum ? `${year}-W${String(weekNum).padStart(2, "0")}` : "";
    const monthKey = monthNum ? `${year}-${String(monthNum).padStart(2, "0")}` : "";

    const status = normalizeStatus(
      col("NOK/KO", "NOKKO", "Status", "Result", "Outcome")
    );

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
      agent: String(
        col("Agent", "AgentName", "Agent Name", "Owner", "Assigned To")
      ).trim(),
      bmsId: String(
        col("BMSID", "BMS_ID", "BMS ID", "EmployeeID", "Employee ID")
      ).trim(),
      status,
    });
  });

  return out;
}
