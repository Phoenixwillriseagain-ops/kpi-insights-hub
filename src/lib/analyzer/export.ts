import { toPng, toJpeg } from "html-to-image";
import * as XLSX from "xlsx";
import type { Dataset } from "./parse";
import type { KpiCode } from "./kpi";
import { KPI_META, KPI_ORDER } from "./kpi";
import {
  exclusionImpact, monthlySummary, overallByKpi, queueBreakdown,
  rawOverallByKpi, weeklySummary,
} from "./compute";

function stamp(): string {
  const d = new Date();
  return d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, "0")
    + String(d.getDate()).padStart(2, "0");
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function exportNodeAsImage(
  node: HTMLElement,
  name: string,
  fmt: "png" | "jpeg" = "png",
) {
  const opts = {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
  };
  const dataUrl = fmt === "png" ? await toPng(node, opts) : await toJpeg(node, { ...opts, quality: 0.95 });
  const safe = name.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase();
  download(dataUrl, `pulse_${safe}_${stamp()}.${fmt === "jpeg" ? "jpg" : "png"}`);
}

export function exportDatasetWorkbook(ds: Dataset, month: string | null) {
  const wb = XLSX.utils.book_new();
  const detected = KPI_ORDER.filter((c) => ds.sla[c]?.length);

  // Overview
  const overview = detected.map((code) => {
    const o = overallByKpi(ds, code, month);
    const raw = rawOverallByKpi(ds, code, month);
    const meta = KPI_META[code];
    return {
      KPI: code,
      Description: meta.what,
      Target: meta.targetLabel,
      "Total Tickets": o.total,
      Breaches: o.breaches,
      "Adj %": Number(o.value.toFixed(2)),
      "Raw %": Number(raw.value.toFixed(2)),
      Status: o.rag,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overview), "Overview");

  // Monthly
  const monthly: Record<string, unknown>[] = [];
  detected.forEach((code) => {
    monthlySummary(ds, code).forEach((p) => {
      monthly.push({ KPI: code, Month: p.label, Total: p.total, Breaches: p.breaches, Rate: Number(p.rate.toFixed(2)), Status: p.rag });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthly), "Monthly");

  // Weekly
  const weekly: Record<string, unknown>[] = [];
  detected.forEach((code) => {
    weeklySummary(ds, code, { lastN: 6 }).forEach((p) => {
      weekly.push({ KPI: code, Week: p.label, Total: p.total, Breaches: p.breaches, Rate: Number(p.rate.toFixed(2)), Status: p.rag });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weekly), "Weekly");

  // Queues
  const queues: Record<string, unknown>[] = [];
  detected.forEach((code) => {
    queueBreakdown(ds, code, month).forEach((q) => {
      queues.push({ KPI: code, Queue: q.queue, Total: q.total, Breaches: q.breaches, Rate: Number(q.rate.toFixed(2)), Status: q.rag });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(queues), "Queues");

  // Exclusion impact
  const excl = detected.map((code) => {
    const e = exclusionImpact(ds, code, month);
    return {
      KPI: code,
      "Raw Total": e.rawTotal,
      "Raw Breaches": e.rawBreaches,
      "Excluded": e.excluded,
      "Adj Total": e.adjTotal,
      "Adj Breaches": e.adjBreaches,
      "Raw %": Number(e.raw.value.toFixed(2)),
      "Adj %": Number(e.adj.value.toFixed(2)),
      "Delta pp": Number((e.adj.value - e.raw.value).toFixed(2)),
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(excl), "Exclusion Impact");

  const fn = `pulse_report_${month ?? "all"}_${stamp()}.xlsx`;
  XLSX.writeFile(wb, fn);
}

export type { KpiCode };
