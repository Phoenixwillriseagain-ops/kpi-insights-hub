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

    const slaFiles   = read(e.data.sla);
    const breachFiles = read(e.data.breach);
    const exclFiles  = read(e.data.excl);

    const report      = buildReport(slaFiles, breachFiles, exclFiles);
    const exclMappings = buildExclMappings(exclFiles);

    // IMPORTANT: buildDataset(slaWbs, pcmsWbs, exclWbs)
    // The breach/PCms workbook goes in slot 2, exclusions in slot 3.
    const ds = buildDataset(
      slaFiles.map((f) => f.wb),
      breachFiles.map((f) => f.wb),  // slot 2 = pcms/breach deep-dive
      exclFiles.map((f) => f.wb),    // slot 3 = exclusions register
    );

    const msg: WorkerOutput = { ok: true, report, exclMappings, ds };
    (self as unknown as Worker).postMessage(msg);
  } catch (err) {
    const msg: WorkerOutput = { ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
