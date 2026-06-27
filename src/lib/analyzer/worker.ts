/// <reference lib="webworker" />
import * as XLSX from "xlsx";
import { buildDataset, type Dataset } from "./parse";
import { buildReport, buildExclMappings, type ValidationReport, type SheetMapping } from "./validate";

export type WorkerInput = {
  sla: { name: string; buf: ArrayBuffer }[];
  breach: { name: string; buf: ArrayBuffer }[];
  excl: { name: string; buf: ArrayBuffer }[];
};

export type WorkerOutput =
  | { ok: true; report: ValidationReport; exclMappings: SheetMapping[]; ds: Dataset }
  | { ok: false; error: string };

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  try {
    const read = (items: { name: string; buf: ArrayBuffer }[]) =>
      items.map((it) => ({ name: it.name, wb: XLSX.read(it.buf, { type: "array" }) }));
    const sla = read(e.data.sla);
    const breach = read(e.data.breach);
    const excl = read(e.data.excl);
    const report = buildReport(sla, breach, excl);
    const exclMappings = buildExclMappings(excl);
    const ds = buildDataset(sla.map((f) => f.wb), breach.map((f) => f.wb), excl.map((f) => f.wb));
    const msg: WorkerOutput = { ok: true, report, exclMappings, ds };
    (self as unknown as Worker).postMessage(msg);
  } catch (err) {
    const msg: WorkerOutput = { ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
