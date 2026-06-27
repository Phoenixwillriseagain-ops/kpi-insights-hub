import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FileDrop } from "@/components/FileDrop";
import { useData } from "@/context/DataContext";
import { parseWorkbookFile } from "@/lib/parseWorkbook";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Upload SLA file · KPI Dashboard" },
      { name: "description", content: "Upload your monthly SLA Excel file to explore KPI compliance, weekly trends, and per-queue breakdowns." },
      { property: "og:title", content: "Upload SLA file · KPI Dashboard" },
      { property: "og:description", content: "Drop your SLA workbook to see KSL/KM KPI trends — Before and After exclusion side-by-side." },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const { workbook, setWorkbook } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handle(file: File) {
    setError(null);
    setBusy(true);
    try {
      const wb = await parseWorkbookFile(file);
      if (wb.records.length === 0) {
        throw new Error("No rows detected. The workbook should contain sheets named KSL-1, KSL-2a, …, KM-1, KM-2 with columns DATE_CLOSE, Queue, ISO_Language, Breach_Description, Excluded.");
      }
      setWorkbook(wb);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Upload your data</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Files are parsed entirely in your browser. Nothing is uploaded or stored anywhere.
          The dashboard reads one workbook with one sheet per KPI; the per-row <code>Excluded</code> flag drives the
          Before / After exclusion comparison shown everywhere.
        </p>
      </div>

      <FileDrop
        label="SLA workbook (.xlsx)"
        hint="Sheets named KSL-1 … KSL-6, KM-1, KM-2. Required columns: DATE_CLOSE, Queue, ISO_Language, Breach_Description, Excluded."
        fileName={workbook?.fileName ?? null}
        onFile={handle}
      />

      {busy && <p className="mt-4 text-sm text-muted-foreground">Parsing workbook…</p>}
      {error && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {workbook && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Detected</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Rows</dt><dd className="font-medium">{workbook.records.length.toLocaleString()}</dd></div>
            <div><dt className="text-muted-foreground">KPI sheets</dt><dd className="font-medium">{workbook.kpisFound.length}</dd></div>
            <div><dt className="text-muted-foreground">Weeks</dt><dd className="font-medium">{workbook.weeks.length}</dd></div>
            <div><dt className="text-muted-foreground">Markets</dt><dd className="font-medium">{workbook.markets.length}</dd></div>
            <div><dt className="text-muted-foreground">Queues</dt><dd className="font-medium">{workbook.queues.length}</dd></div>
            <div className="col-span-2 sm:col-span-3"><dt className="text-muted-foreground">KPIs found</dt><dd className="font-medium">{workbook.kpisFound.join(", ")}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => navigate({ to: "/overview" })}>Overview</Button>
            <Button variant="secondary" onClick={() => navigate({ to: "/trend" })}>6-Week Trend</Button>
            <Button variant="secondary" onClick={() => navigate({ to: "/queues" })}>Per Queue / Market</Button>
          </div>
        </div>
      )}
    </main>
  );
}
