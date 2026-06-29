import * as XLSX from "xlsx";
import { KPI_ORDER, matchKpi, type KpiCode } from "./kpi";
import { parsePcms } from "./parsePcms";
import type { SlaRow, BreachRow, ExclRow, Dataset } from "./parseTypes";

// Re-export pure types/selectors so existing imports keep working.
export type { SlaRow, BreachRow, ExclRow, Dataset } from "./parseTypes";
export { exclSet, filteredRows, rawRows } from "./parseTypes";

function parseDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  const p = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (p) {
    let y = parseInt(p[3], 10);
    if (y < 100) y += 2000;
    d = new Date(y, parseInt(p[2], 10) - 1, parseInt(p[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isoWeekStr(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + "-W" + (wk < 10 ? "0" : "") + wk;
}

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

export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array" });
}

export function parseSla(wb: XLSX.WorkBook): Partial<Record<KpiCode, SlaRow[]>> {
  const out: Partial<Record<KpiCode, SlaRow[]>> = {};
  for (const sheetName of wb.SheetNames) {
    const code = matchKpi(sheetName);
    if (!code) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
    const acc: SlaRow[] = out[code] ?? [];
    rows.forEach((r, ri) => {
      const col = makeCol(r);
      const d = parseDate(col("DATECLOSE", "DATE_CLOSE", "CLOSEDDATE", "CLOSEDATE", "RESOLVEDDATE", "RESOLUTION_DATE"));
      const month = d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") : "unknown";
      const week = d ? isoWeekStr(d) : "No week";
      const ticket = String(col("TICKET", "TICKETID", "TICKET_ID", "ID", "CASEID", "INCIDENTTICKET") || "").trim() || `__row_${ri}`;
      const breachVal = col("IS_BREACH", "ISBREACH", "BREACH", "BREACH_FLAG");
      const breachTime = String(col("DATE_TIME_BREACH", "DATETIMEBREACH", "BREACHTIME") || "").trim();
      const isBreach = breachVal === 1 || String(breachVal).trim() === "1" || String(breachVal).toUpperCase() === "Y" ||
                       String(breachVal).toUpperCase() === "YES" || (!!breachTime && breachTime !== "0");
      const exclRaw = String(col("EXCLUDED", "IS_EXCLUDED", "EXCLUDE") || "").trim();
      acc.push({
  ticket,
  month,
  week,
  queue: String(col("Queue") || col("QUEUE") || col("TEAM") || col("GROUP") || col("DEPARTMENT") || "Unknown"),
  language: String(col("ISOLANGUAGE", "ISO_LANGUAGE", "LANGUAGE", "LANG") || "unknown"),
  isBreach,
  isExcluded: exclRaw === "1" || exclRaw.toUpperCase() === "Y",
});
    });
    out[code] = acc;
  }
  return out;
}

export function parseBreach(wb: XLSX.WorkBook): Partial<Record<KpiCode, BreachRow[]>> {
  const out: Partial<Record<KpiCode, BreachRow[]>> = {};
  for (const sheetName of wb.SheetNames) {
    const code = matchKpi(sheetName);
    if (!code) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
    const acc: BreachRow[] = out[code] ?? [];
    rows.forEach((r) => {
      const col = makeCol(r);
      const exclRaw = String(col("EXCLUDED", "IS_EXCLUDED", "EXCLUDE") || "").trim();
      const isExcluded = exclRaw === "1" || exclRaw.toUpperCase() === "Y";
      if (isExcluded) return;
      const wv = String(col("WEEK", "WEEK_NUMBER", "WEEKNUMBER") || "");
      let week = /^\d{4}-W\d{2}$/.test(wv) ? wv : "No week";
      if (week === "No week") {
        const d = parseDate(col("DATECLOSE", "DATE_CLOSE", "CLOSEDDATE", "CLOSEDATE"));
        if (d) week = isoWeekStr(d);
      }
      const monV = String(col("MONTH", "PERIOD", "YEARMONTH") || "");
      const month = /^\d{4}-\d{2}$/.test(monV) ? monV : (week !== "No week" ? week.slice(0, 7) : "unknown");
      acc.push({
  ticket: String(col("TICKET", "TICKETID", "TICKET_ID", "ID", "CASEID") || ""),
  week,
  month,
  queue: String(col("Queue") || col("QUEUE") || col("TEAM") || col("GROUP") || col("DEPARTMENT") || "Unknown"),
  agent: String(col("AGENT", "AGENTNAME", "AGENT_NAME", "OWNER") || ""),
  reason: String(col("REASON", "BREACH_REASON", "BREACHREASON") || ""),
  aos: String(col("AOS", "SLA_TYPE", "SLATYPE", "TYPE") || ""),
  comment: String(col("COMMENT", "COMMENTS", "NOTE", "NOTES") || ""),
});
    });
    out[code] = acc;
  }
  return out;
}

export function parseExcl(wb: XLSX.WorkBook): Partial<Record<KpiCode, ExclRow[]>> {
  const out: Partial<Record<KpiCode, ExclRow[]>> = {};
  for (const sheetName of wb.SheetNames) {
    const code = matchKpi(sheetName);
    if (!code) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: "" });
    const acc: ExclRow[] = out[code] ?? [];
    rows.forEach((r) => {
      const col = makeCol(r);
      const ticket = String(col("TICKET", "TICKETID", "TICKET_ID", "ID", "CASEID", "INCIDENTTICKET", "TICKETNUMBER") || "").trim();
      const exclVal = col("EXCLUDED", "IS_EXCLUDED", "EXCLUDE");
      const isExcluded = exclVal === 1 || String(exclVal).trim() === "1";
      if (!ticket || !isExcluded) return;
      acc.push({
        ticket,
        reason: String(col("REASON", "EXCLUSIONREASON", "EXCLUSION_REASON", "CAUSE") || ""),
        comment: String(col("COMMENT", "COMMENTS", "NOTE", "NOTES") || ""),
        jira: String(col("JIRA", "JIRAID", "JIRA_ID", "JIRAREF", "JIRAREFERENCE") || ""),
        date: String(col("DATECLOSE", "DATE_CLOSE", "CLOSEDDATE", "DATE") || ""),
        priority: String(col("PRIORITY", "PRIO") || ""),
      });
    });
    out[code] = acc;
  }
  return out;
}

export function buildDataset(
  slaWbs: XLSX.WorkBook[],
  pcmsWbs: XLSX.WorkBook[],
  exclWbs: XLSX.WorkBook[],
): Dataset {
  const ds: Dataset = { sla: {}, breach: {}, excl: {}, pcms: [], months: [], weeks: [] };
  const mergeInto = <T,>(dst: Partial<Record<KpiCode, T[]>>, src: Partial<Record<KpiCode, T[]>>) => {
    for (const code of Object.keys(src) as KpiCode[]) {
      dst[code] = [...(dst[code] ?? []), ...(src[code] ?? [])];
    }
  };
  slaWbs.forEach((wb) => mergeInto(ds.sla, parseSla(wb)));
  exclWbs.forEach((wb) => mergeInto(ds.excl, parseExcl(wb)));

  const months = new Set<string>(), weeks = new Set<string>();
  KPI_ORDER.forEach((code) => {
    (ds.sla[code] ?? []).filter((r) => !r.isExcluded).forEach((r) => {
      if (r.month && r.month !== "unknown") months.add(r.month);
      if (r.week && r.week !== "No week") weeks.add(r.week);
    });
  });
  ds.months = [...months].sort();
  ds.weeks = [...weeks].sort();

  // Infer dominant year from SLA dataset so PCms week/month strings can align.
  const yearCounts: Record<string, number> = {};
  ds.months.forEach((m) => { const y = m.slice(0, 4); yearCounts[y] = (yearCounts[y] ?? 0) + 1; });
  const inferYear = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const year = inferYear ? parseInt(inferYear, 10) : null;
  pcmsWbs.forEach((wb) => { ds.pcms.push(...parsePcms(wb, year)); });

  return ds;
}
