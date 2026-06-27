import * as XLSX from "xlsx";
import { KPIS } from "./kpiConfig";

export type TicketRow = {
  queue: string;
  market: string; // ISO_Language
  isoWeek: string; // e.g. "W22 '26"
  weekKey: string; // sortable e.g. "2026-W22"
  // per-KPI: applicable + breach (1/0). undefined = not applicable to this row
  kpi: Record<string, { applicable: boolean; breach: boolean }>;
};

export type ParsedWorkbook = {
  rows: TicketRow[];
  weeks: string[]; // sorted ascending weekKey
  weekLabels: Record<string, string>; // weekKey -> "W22 '26"
  markets: string[];
  queues: string[];
  detectedColumns: {
    queue: string | null;
    market: string | null;
    date: string | null;
    perKpi: Record<string, { applicable: string | null; breach: string | null; single: string | null }>;
  };
};

function norm(s: string) {
  return s.toLowerCase().replace(/[\s_\-\.]/g, "");
}

function findCol(headers: string[], candidates: string[]): string | null {
  const map = new Map(headers.map((h) => [norm(h), h]));
  for (const c of candidates) {
    const hit = map.get(norm(c));
    if (hit) return hit;
  }
  // partial match
  for (const c of candidates) {
    const nc = norm(c);
    for (const h of headers) {
      if (norm(h).includes(nc)) return h;
    }
  }
  return null;
}

function isoWeekFromDate(d: Date): { key: string; label: string } {
  // ISO week calc
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const yy = String(date.getUTCFullYear()).slice(-2);
  const ww = String(weekNo).padStart(2, "0");
  return { key: `${date.getUTCFullYear()}-W${ww}`, label: `W${ww} '${yy}` };
}

function parseDateCell(v: any): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function truthy(v: any): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "breach", "breached", "x", "ko", "fail", "nok"].includes(s);
}

// "Applicable" detection: if column exists, use it; otherwise assume applicable.
function applicableFromVal(v: any): boolean {
  if (v == null || v === "") return true; // assume applicable when blank-but-evaluated rows are filtered elsewhere
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["0", "false", "no", "n", "n/a", "na", "-", "notapplicable"].includes(s)) return false;
  return true;
}

export async function parseWorkbookFile(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  // Pick the largest sheet
  let best: { name: string; rows: any[] } = { name: "", rows: [] };
  for (const name of wb.SheetNames) {
    const json = XLSX.utils.sheet_to_json<any>(wb.Sheets[name], { defval: null });
    if (json.length > best.rows.length) best = { name, rows: json };
  }
  const sample = best.rows[0] ?? {};
  const headers = Object.keys(sample);

  const queueCol = findCol(headers, ["Queue", "QueueName", "Queue Name"]);
  const marketCol = findCol(headers, ["ISO_Language", "ISOLanguage", "Market", "Language", "ISO Language"]);
  const dateCol = findCol(headers, [
    "Week", "ISOWeek", "ISO_Week",
    "CreatedAt", "Created At", "Created", "CreationDate", "Creation Date",
    "Date", "TicketDate", "Ticket Date",
  ]);

  const perKpi: ParsedWorkbook["detectedColumns"]["perKpi"] = {};
  for (const k of KPIS) {
    const base = k.code;
    const applicable = findCol(headers, [`${base}_Applicable`, `${base} Applicable`, `${base}_App`, `${base}Applicable`]);
    const breach = findCol(headers, [`${base}_Breach`, `${base} Breach`, `${base}_Breached`, `${base}Breach`]);
    const single = applicable || breach ? null : findCol(headers, [base, base.replace("-", "")]);
    perKpi[base] = { applicable, breach, single };
  }

  const weekSet = new Set<string>();
  const weekLabels: Record<string, string> = {};
  const markets = new Set<string>();
  const queues = new Set<string>();
  const rows: TicketRow[] = [];

  for (const r of best.rows) {
    const queue = queueCol ? String(r[queueCol] ?? "").trim() : "";
    const market = marketCol ? String(r[marketCol] ?? "").trim() : "";
    if (!queue && !market) continue;

    let weekKey = "";
    let weekLabel = "";
    if (dateCol) {
      const v = r[dateCol];
      const d = parseDateCell(v);
      if (d) {
        const w = isoWeekFromDate(d);
        weekKey = w.key;
        weekLabel = w.label;
      } else if (typeof v === "string" && /W\d{1,2}/i.test(v)) {
        // already a week label like "W22 '26"
        weekLabel = v.trim();
        const m = v.match(/W(\d{1,2}).*?(\d{2,4})/i);
        if (m) {
          const ww = m[1].padStart(2, "0");
          const yy = m[2].length === 2 ? `20${m[2]}` : m[2];
          weekKey = `${yy}-W${ww}`;
        }
      }
    }
    if (!weekKey) continue;

    const kpi: TicketRow["kpi"] = {};
    for (const k of KPIS) {
      const cfg = perKpi[k.code];
      let applicable = true;
      let breach = false;
      if (cfg.applicable) applicable = applicableFromVal(r[cfg.applicable]);
      if (cfg.breach) breach = truthy(r[cfg.breach]);
      else if (cfg.single) {
        const v = r[cfg.single];
        if (v == null || v === "") applicable = false;
        else breach = truthy(v);
      } else if (!cfg.applicable) {
        applicable = false; // no column detected for this KPI
      }
      kpi[k.code] = { applicable, breach };
    }

    if (queue) queues.add(queue);
    if (market) markets.add(market);
    weekSet.add(weekKey);
    weekLabels[weekKey] = weekLabel;

    rows.push({ queue, market, isoWeek: weekLabel, weekKey, kpi });
  }

  const weeks = Array.from(weekSet).sort();

  return {
    rows,
    weeks,
    weekLabels,
    markets: Array.from(markets).sort(),
    queues: Array.from(queues).sort(),
    detectedColumns: { queue: queueCol, market: marketCol, date: dateCol, perKpi },
  };
}
