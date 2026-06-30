import * as XLSX from "xlsx";
import { KPI_ORDER, matchKpi, type KpiCode } from "./kpi";
import { parsePcms } from "./parsePcms";
import type { SlaRow, BreachRow, ExclRow, Dataset } from "./parseTypes";

// Re-export pure types/selectors so existing imports keep working.
export type { SlaRow, BreachRow, ExclRow, Dataset } from "./parseTypes";
export { exclSet, filteredRows, rawRows } from "./parseTypes";

function normText(v: unknown, fallback = ""): string {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s || fallback;
}

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

// Named-header fallback helper (used by parseBreach / parseExcl)
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

// Column index layout — matches breaches-tracker config.js C_XLSX exactly:
// 0:Incident Ticket  1:DATE_CLOSE  2:Status  3:Queue  4:Priority
// 5:ISO_Language  6:Tool  7:TOPIC  8:SLA_Code  9:SLA_N
// 10:Breach_Description  11:DATE_TIME_Breach
// 19:Excluded  21:Week
const COL = {
  ticket:     0,
  date_close: 1,
  queue:      3,
  lang:       5,
  sla_code:   8,
  breach_dt:  11,
  excluded:   19,
};

export function parseSla(wb: XLSX.WorkBook): Partial<Record<KpiCode, SlaRow[]>> {
  const out: Partial<Record<KpiCode, SlaRow[]>> = {};

  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Instructions") continue;

    // Array mode — same as breaches-tracker — guarantees positional index access
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (rawRows.length < 2) continue;

    // Skip header row if first cell looks like a label
    const firstRow = rawRows[0] as unknown[];
    const hasHeader = typeof firstRow[COL.ticket] === "string" &&
      /ticket|incident|id/i.test(String(firstRow[COL.ticket]));
    const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

    dataRows.forEach((r: unknown, ri: number) => {
      const row = r as unknown[];

      // Route by SLA_Code column (col 8) — not by sheet name
      const slaCode = String(row[COL.sla_code] ?? "").trim();
      const code = matchKpi(slaCode);
      if (!code) return; // skip rows with unknown/blank SLA code

      const ticketRaw = String(row[COL.ticket] ?? "").trim();
      if (!ticketRaw) return;
      const ticket = ticketRaw || `__row_${ri}`;

      const d = parseDate(row[COL.date_close]);
      const month = d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") : "unknown";
      const week = d ? isoWeekStr(d) : "No week";

      const queue = normText(row[COL.queue], "Unknown");
      const language = normText(row[COL.lang], "unknown");

      // Breach: DATE_TIME_Breach (col 11) non-empty = breach
      const breachDt = String(row[COL.breach_dt] ?? "").trim();
      const isBreach = !!breachDt && breachDt !== "0";

      const exclRaw = String(row[COL.excluded] ?? "").trim();
      const isExcluded = exclRaw === "1" || exclRaw.toUpperCase() === "Y" || exclRaw.toUpperCase() === "YES";

      const acc = out[code] ?? [];
      acc.push({ ticket, month, week, queue, language, isBreach, isExcluded });
      out[code] = acc;
    });
  }

  return out;
}

export function parseBreach(wb: XLSX.WorkBook): Partial<Record<KpiCode, BreachRow[]>> {
  const out: Partial<Record<KpiCode, BreachRow[]>> = {};

  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Instructions") continue;

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (rawRows.length < 2) continue;

    const firstRow = rawRows[0] as unknown[];
    const hasHeader = typeof firstRow[COL.ticket] === "string" &&
      /ticket|incident|id/i.test(String(firstRow[COL.ticket]));
    const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

    dataRows.forEach((r: unknown) => {
      const row = r as unknown[];

      const slaCode = String(row[COL.sla_code] ?? "").trim();
      const code = matchKpi(slaCode);
      if (!code) return;

      const exclRaw = String(row[COL.excluded] ?? "").trim();
      const isExcluded = exclRaw === "1" || exclRaw.toUpperCase() === "Y";
      if (isExcluded) return;

      const breachDt = String(row[COL.breach_dt] ?? "").trim();
      if (!breachDt || breachDt === "0") return; // no breach = not a breach row

      const d = parseDate(row[COL.date_close]);
      const week = d ? isoWeekStr(d) : "No week";
      const month = d ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") : "unknown";

      const acc = out[code] ?? [];
      acc.push({
        ticket:  String(row[COL.ticket] ?? "").trim(),
        week,
        month,
        queue:   normText(row[COL.queue], "Unknown"),
        agent:   normText(row[5 + 10] /* col 15 = Agent */),
        reason:  normText(row[13] /* col 13 = Reason */),
        aos:     normText(row[14] /* col 14 = AOS */),
        comment: normText(row[17] /* col 17 = Comment */),
      });
      out[code] = acc;
    });
  }

  return out;
}

export function parseExcl(wb: XLSX.WorkBook): Partial<Record<KpiCode, ExclRow[]>> {
  const out: Partial<Record<KpiCode, ExclRow[]>> = {};

  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Instructions") continue;

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (rawRows.length < 2) continue;

    const firstRow = rawRows[0] as unknown[];
    const hasHeader = typeof firstRow[COL.ticket] === "string" &&
      /ticket|incident|id/i.test(String(firstRow[COL.ticket]));
    const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

    dataRows.forEach((r: unknown) => {
      const row = r as unknown[];

      const ticketRaw = String(row[COL.ticket] ?? "").trim();
      if (!ticketRaw) return;

      const exclRaw = String(row[COL.excluded] ?? "").trim();
      const isExcluded = exclRaw === "1" || exclRaw.toUpperCase() === "Y" || exclRaw.toUpperCase() === "YES";
      if (!isExcluded) return;

      const slaCode = String(row[COL.sla_code] ?? "").trim();
      const code = matchKpi(slaCode);
      if (!code) return;

      const acc = out[code] ?? [];
      acc.push({
        ticket:   ticketRaw,
        reason:   normText(row[13]),
        comment:  normText(row[17]),
        jira:     normText(row[20]),
        date:     String(row[COL.date_close] ?? ""),
        priority: normText(row[4]),
      });
      out[code] = acc;
    });
  }

  return out;
}

export function buildDataset(
  slaWbs: XLSX.WorkBook[],
  pcmsWbs: XLSX.WorkBook[],
  exclWbs: XLSX.WorkBook[],
): Dataset {
  const ds: Dataset = { sla: {}, breach: {}, excl: {}, pcms: [], months: [], weeks: [] };

  const mergeInto = <T,>(
    dst: Partial<Record<KpiCode, T[]>>,
    src: Partial<Record<KpiCode, T[]>>
  ) => {
    for (const code of Object.keys(src) as KpiCode[]) {
      dst[code] = [...(dst[code] ?? []), ...(src[code] ?? [])];
    }
  };

  slaWbs.forEach((wb) => mergeInto(ds.sla, parseSla(wb)));
  pcmsWbs.forEach((wb) => mergeInto(ds.breach, parseBreach(wb)));
  exclWbs.forEach((wb) => mergeInto(ds.excl, parseExcl(wb)));

  const months = new Set<string>();
  const weeks = new Set<string>();

  KPI_ORDER.forEach((code) => {
    (ds.sla[code] ?? [])
      .filter((r) => !r.isExcluded)
      .forEach((r) => {
        if (r.month && r.month !== "unknown") months.add(r.month);
        if (r.week && r.week !== "No week") weeks.add(r.week);
      });

    (ds.breach[code] ?? []).forEach((r) => {
      if (r.month && r.month !== "unknown") months.add(r.month);
      if (r.week && r.week !== "No week") weeks.add(r.week);
    });
  });

  ds.months = [...months].sort();
  ds.weeks = [...weeks].sort();

  const yearCounts: Record<string, number> = {};
  ds.months.forEach((m) => {
    const y = m.slice(0, 4);
    yearCounts[y] = (yearCounts[y] ?? 0) + 1;
  });

  const inferYear = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const year = inferYear ? parseInt(inferYear, 10) : null;

  pcmsWbs.forEach((wb) => {
    ds.pcms.push(...parsePcms(wb, year));
  });

  console.log("buildDataset result", {
    sla: Object.fromEntries(Object.entries(ds.sla).map(([k, v]) => [k, v?.length ?? 0])),
    breach: Object.fromEntries(Object.entries(ds.breach).map(([k, v]) => [k, v?.length ?? 0])),
    pcms: ds.pcms.length,
    months: ds.months,
    weeks: ds.weeks.length,
  });

  return ds;
}
