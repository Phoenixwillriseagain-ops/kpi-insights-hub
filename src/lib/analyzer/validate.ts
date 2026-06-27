import * as XLSX from "xlsx";
import { matchKpi } from "./kpi";

export type Severity = "error" | "warn" | "info";
export type ValidationIssue = {
  file: string;
  sheet?: string;
  severity: Severity;
  message: string;
  hint?: string;
};
export type ValidationReport = {
  ok: boolean;          // no errors
  issues: ValidationIssue[];
};

const norm = (s: string) => s.replace(/[\s_\-./]/g, "").toLowerCase();

// Required / optional column synonyms per workbook kind.
const SLA_REQUIRED: Record<string, string[]> = {
  Ticket:     ["TICKET", "TICKETID", "TICKET_ID", "ID", "CASEID", "INCIDENTTICKET", "TICKETNUMBER"],
  DateClose:  ["DATECLOSE", "DATE_CLOSE", "CLOSEDDATE", "CLOSEDATE", "RESOLVEDDATE", "RESOLUTION_DATE"],
  Queue:      ["QUEUE", "TEAM", "GROUP", "DEPARTMENT"],
  Excluded:   ["EXCLUDED", "IS_EXCLUDED", "EXCLUDE"],
  Breach:     ["IS_BREACH", "ISBREACH", "BREACH", "BREACH_FLAG", "DATE_TIME_BREACH", "DATETIMEBREACH", "BREACHTIME"],
};

const PCMS_REQUIRED: Record<string, string[]> = {
  Ticket: ["TICKET", "TICKETID", "TICKET_ID", "INCIDENTTICKET"],
  Reason: ["REASON", "PCMS_REASON", "CATEGORY", "REASONCATEGORY"],
  Status: ["STATUS", "KO_NOK", "RESULT"],
};

const EXCL_REQUIRED: Record<string, string[]> = {
  Ticket:   ["TICKET", "TICKETID", "TICKET_ID", "INCIDENTTICKET", "TICKETNUMBER"],
  Excluded: ["EXCLUDED", "IS_EXCLUDED", "EXCLUDE"],
};

function pickHeader(sheet: XLSX.WorkSheet): string[] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  for (const row of aoa.slice(0, 5)) {
    const cells = (row ?? []).map((c) => String(c ?? "").trim()).filter(Boolean);
    if (cells.length >= 3) return cells;
  }
  return [];
}

function findMissing(headers: string[], required: Record<string, string[]>): string[] {
  const have = new Set(headers.map(norm));
  return Object.entries(required)
    .filter(([, syn]) => !syn.some((s) => have.has(norm(s))))
    .map(([k]) => k);
}

function suggest(headers: string[], required: Record<string, string[]>, label: string): string {
  const syn = required[label] ?? [];
  // crude similarity: any header containing one of synonyms (substring)
  const candidate = headers.find((h) => syn.some((s) => norm(h).includes(norm(s).slice(0, 4))));
  return candidate ? `Closest header: "${candidate}". Rename to "${syn[0]}".` : `Add a "${syn[0]}" column.`;
}

// Sheets that the KSL-4 & KM-1 analysis tab depends on.
const QUALITY_SHEETS = ["KSL-4", "KM-1"] as const;

export function validateSla(file: string, wb: XLSX.WorkBook): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const kpiSheets = wb.SheetNames.filter((n) => matchKpi(n));
  if (kpiSheets.length === 0) {
    out.push({
      file, severity: "error",
      message: "No KPI sheets detected.",
      hint: "Sheet names must include codes like KSL-1, KSL-2a, KSL-5b, KM-1, KM-2.",
    });
    return out;
  }
  // Guard the KSL-4 / KM-1 tab: both sheets must be present *and* parseable.
  const matchedCodes = new Set(kpiSheets.map((n) => matchKpi(n)));
  QUALITY_SHEETS.forEach((code) => {
    if (!matchedCodes.has(code)) {
      out.push({
        file, severity: "error",
        message: `Missing sheet for ${code}.`,
        hint: `The KSL-4 & KM-1 tab needs a sheet named "${code}" (or a close variant). Rename one of the sheets so it starts with "${code}".`,
      });
    }
  });
  kpiSheets.forEach((name) => {
    const code = matchKpi(name);
    const isQuality = code === "KSL-4" || code === "KM-1";
    const headers = pickHeader(wb.Sheets[name]);
    if (headers.length === 0) {
      out.push({
        file, sheet: name,
        severity: isQuality ? "error" : "warn",
        message: "Sheet looks empty or has no header row.",
        hint: isQuality ? `${code} powers the KSL-4 & KM-1 tab — add a header row with Ticket, DATE_CLOSE, Queue, Excluded, Breach columns.` : undefined,
      });
      return;
    }
    const missing = findMissing(headers, SLA_REQUIRED);
    missing.forEach((m) => {
      const required = m === "Excluded" || m === "Ticket" || m === "Breach";
      const sev: Severity = isQuality || required ? "error" : "warn";
      out.push({
        file, sheet: name, severity: sev,
        message: `Missing required column: ${m}${isQuality ? ` (needed for ${code} analysis)` : ""}.`,
        hint: suggest(headers, SLA_REQUIRED, m),
      });
    });
  });
  return out;
}


export function validatePcms(file: string, wb: XLSX.WorkBook): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const sheet = wb.SheetNames.find((n) => /overall/i.test(n)) ?? wb.SheetNames[0];
  if (!sheet) {
    out.push({ file, severity: "error", message: "Workbook has no sheets." });
    return out;
  }
  const headers = pickHeader(wb.Sheets[sheet]);
  if (headers.length === 0) {
    out.push({ file, sheet, severity: "error", message: "Sheet has no detectable header row." });
    return out;
  }
  const missing = findMissing(headers, PCMS_REQUIRED);
  missing.forEach((m) =>
    out.push({
      file, sheet, severity: m === "Ticket" ? "error" : "warn",
      message: `Missing column: ${m}.`,
      hint: suggest(headers, PCMS_REQUIRED, m),
    }),
  );
  return out;
}

export function validateExcl(file: string, wb: XLSX.WorkBook): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  wb.SheetNames.forEach((name) => {
    if (!matchKpi(name)) return;
    const headers = pickHeader(wb.Sheets[name]);
    if (headers.length === 0) return;
    const missing = findMissing(headers, EXCL_REQUIRED);
    missing.forEach((m) =>
      out.push({
        file, sheet: name, severity: "warn",
        message: `Exclusion sheet missing: ${m}.`,
        hint: suggest(headers, EXCL_REQUIRED, m),
      }),
    );
  });
  if (!wb.SheetNames.some((n) => matchKpi(n))) {
    out.push({
      file, severity: "warn",
      message: "No KPI-coded sheets found in exclusions workbook.",
      hint: "Name each sheet after the KPI it applies to (e.g. KSL-2c).",
    });
  }
  return out;
}

export function buildReport(
  sla: { name: string; wb?: XLSX.WorkBook }[],
  pcms: { name: string; wb?: XLSX.WorkBook }[],
  excl: { name: string; wb?: XLSX.WorkBook }[],
): ValidationReport {
  const issues: ValidationIssue[] = [];
  sla.forEach((f) => f.wb && issues.push(...validateSla(f.name, f.wb)));
  pcms.forEach((f) => f.wb && issues.push(...validatePcms(f.name, f.wb)));
  excl.forEach((f) => f.wb && issues.push(...validateExcl(f.name, f.wb)));
  return { ok: !issues.some((i) => i.severity === "error"), issues };
}
