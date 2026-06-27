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

// Dice coefficient on bigrams for fuzzy header similarity.
function bigrams(s: string): Set<string> {
  const n = norm(s); const out = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
  return out;
}
function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((g) => B.has(g) && inter++);
  return (2 * inter) / (A.size + B.size);
}
export function bestMatch(headers: string[], synonyms: string[]): { header: string; score: number } | null {
  let best: { header: string; score: number } | null = null;
  for (const h of headers) {
    for (const s of synonyms) {
      const score = norm(h) === norm(s) ? 1 : Math.max(
        dice(h, s),
        norm(h).includes(norm(s)) || norm(s).includes(norm(h)) ? 0.7 : 0,
      );
      if (!best || score > best.score) best = { header: h, score };
    }
  }
  return best;
}
function suggest(headers: string[], required: Record<string, string[]>, label: string): string {
  const syn = required[label] ?? [];
  const m = bestMatch(headers, syn);
  if (m && m.score >= 0.4) return `Closest header: "${m.header}" (${Math.round(m.score * 100)}% match). Rename to "${syn[0]}".`;
  return `Add a "${syn[0]}" column.`;
}

export type MappingSuggestion = {
  required: string;          // canonical name (e.g. "Excluded")
  canonical: string;         // suggested rename target (e.g. "EXCLUDED")
  candidate: string | null;  // closest existing header
  score: number;             // 0..1
  status: "ok" | "rename" | "missing";
};
export type SheetMapping = {
  file: string;
  sheet: string;
  headers: string[];
  rows: MappingSuggestion[];
};

function buildSheetMapping(
  file: string, sheet: string, headers: string[], required: Record<string, string[]>,
): SheetMapping {
  const have = new Set(headers.map(norm));
  const rows: MappingSuggestion[] = Object.entries(required).map(([req, syn]) => {
    const exact = syn.find((s) => have.has(norm(s)));
    if (exact) {
      const header = headers.find((h) => norm(h) === norm(exact))!;
      return { required: req, canonical: syn[0], candidate: header, score: 1, status: "ok" };
    }
    const m = bestMatch(headers, syn);
    if (m && m.score >= 0.4) return { required: req, canonical: syn[0], candidate: m.header, score: m.score, status: "rename" };
    return { required: req, canonical: syn[0], candidate: m?.header ?? null, score: m?.score ?? 0, status: "missing" };
  });
  return { file, sheet, headers, rows };
}

export function buildExclMappings(files: { name: string; wb?: XLSX.WorkBook }[]): SheetMapping[] {
  const out: SheetMapping[] = [];
  files.forEach(({ name, wb }) => {
    if (!wb) return;
    wb.SheetNames.forEach((sheet) => {
      if (!matchKpi(sheet)) return;
      const headers = pickHeader(wb.Sheets[sheet]);
      if (headers.length === 0) return;
      const mapping = buildSheetMapping(name, sheet, headers, EXCL_REQUIRED);
      // Only surface sheets that need attention.
      if (mapping.rows.some((r) => r.status !== "ok")) out.push(mapping);
    });
  });
  return out;
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
