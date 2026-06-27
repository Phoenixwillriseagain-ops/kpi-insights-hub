import * as XLSX from "xlsx";
import { KPIS } from "./kpiConfig";

export type KpiRecord = {
  kpiCode: string;
  ticket: string;
  queue: string;
  market: string; // ISO_Language
  weekKey: string; // sortable "2026-W22"
  weekLabel: string; // "W22 '26"
  excluded: boolean;
  breach: boolean;
  dateClose: Date | null;
};

export type ParsedWorkbook = {
  records: KpiRecord[];
  weeks: string[]; // sorted ascending weekKey
  weekLabels: Record<string, string>;
  markets: string[];
  queues: string[];
  kpisFound: string[];
  sheetCounts: Record<string, number>; // per-KPI row count (raw)
  fileName: string;
};

function isoWeekFromDate(d: Date): { key: string; label: string } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const yy = String(date.getUTCFullYear()).slice(-2);
  const ww = String(weekNo).padStart(2, "0");
  return { key: `${date.getUTCFullYear()}-W${ww}`, label: `W${ww} '${yy}` };
}

function parseDateCell(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function isExcluded(v: unknown): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "x";
}

function isBreach(v: unknown): boolean {
  if (v == null) return false;
  return String(v).trim().length > 0;
}

const KPI_CODES = new Set(KPIS.map((k) => k.code));

export async function parseWorkbookFile(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const records: KpiRecord[] = [];
  const weekLabels: Record<string, string> = {};
  const weekSet = new Set<string>();
  const markets = new Set<string>();
  const queues = new Set<string>();
  const kpisFound: string[] = [];
  const sheetCounts: Record<string, number> = {};

  for (const sheetName of wb.SheetNames) {
    if (!KPI_CODES.has(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    if (rows.length === 0) continue;
    kpisFound.push(sheetName);
    sheetCounts[sheetName] = rows.length;

    for (const r of rows) {
      const ticket = String(r["Incident Ticket"] ?? "").trim();
      const queue = String(r["Queue"] ?? "").trim();
      const market = String(r["ISO_Language"] ?? "").trim();
      const dc = parseDateCell(r["DATE_CLOSE"]);
      if (!dc) continue;
      const { key, label } = isoWeekFromDate(dc);
      const excluded = isExcluded(r["Excluded"]);
      const breach = isBreach(r["Breach_Description"]);

      records.push({
        kpiCode: sheetName,
        ticket,
        queue,
        market,
        weekKey: key,
        weekLabel: label,
        excluded,
        breach,
        dateClose: dc,
      });

      weekSet.add(key);
      weekLabels[key] = label;
      if (queue) queues.add(queue);
      if (market) markets.add(market);
    }
  }

  return {
    records,
    weeks: Array.from(weekSet).sort(),
    weekLabels,
    markets: Array.from(markets).sort(),
    queues: Array.from(queues).sort(),
    kpisFound,
    sheetCounts,
    fileName: file.name,
  };
}
