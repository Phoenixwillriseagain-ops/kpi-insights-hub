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
      { name: "description", content: "Upload your weekly SLA Excel file to explore KPI compliance, trends, and per-queue breakdowns." },
      { property: "og:title", content: "Upload SLA file · KPI Dashboard" },
      { property: "og:description", content: "Drop your SLA workbook to see KSL/KM KPI trends." },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const { main, mainName, exclusion, exclusionName, setMain, setExclusion } = useData();
  const [busy, setBusy] = useState<"main" | "exclusion" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handle(file: File, kind: "main" | "exclusion") {
    setError(null);
    setBusy(kind);
    try {
      const wb = await parseWorkbookFile(file);
      if (wb.rows.length === 0) {
        throw new Error("No rows detected. Check that the file has Queue, ISO_Language, and a date/week column.");
      }
      if (kind === "main") setMain(wb, file.name);
      else setExclusion(wb, file.name);
    } catch (e: any) {
      setError(e?.message ?? "Failed to parse file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Upload your data</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Files are parsed entirely in your browser. Nothing is uploaded or stored anywhere.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FileDrop
          label="Main SLA file"
          hint=".xlsx with columns Queue, ISO_Language, date/week, plus KPI breach indicators"
          fileName={mainName}
          onFile={(f) => handle(f, "main")}
        />
        <FileDrop
          label="Exclusion file (optional)"
          hint="Same shape as main; toggled via the 'Before / After excl.' switch"
          fileName={exclusionName}
          onFile={(f) => handle(f, "exclusion")}
        />
      </div>
      {busy && <p className="mt-4 text-sm text-muted-foreground">Parsing {busy} file…</p>}
      {error && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {main && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Detected in main file</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
            <div><dt className="text-foreground">Rows</dt><dd>{main.rows.length.toLocaleString()}</dd></div>
            <div><dt className="text-foreground">Weeks</dt><dd>{main.weeks.length}</dd></div>
            <div><dt className="text-foreground">Markets</dt><dd>{main.markets.length}</dd></div>
            <div><dt className="text-foreground">Queues</dt><dd>{main.queues.length}</dd></div>
            <div><dt className="text-foreground">Queue col</dt><dd>{main.detectedColumns.queue ?? "—"}</dd></div>
            <div><dt className="text-foreground">Market col</dt><dd>{main.detectedColumns.market ?? "—"}</dd></div>
            <div><dt className="text-foreground">Date col</dt><dd>{main.detectedColumns.date ?? "—"}</dd></div>
          </dl>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => navigate({ to: "/overview" })}>Go to Overview</Button>
            <Button variant="secondary" onClick={() => navigate({ to: "/trend" })}>6-Week Trend</Button>
            <Button variant="secondary" onClick={() => navigate({ to: "/queues" })}>Per Queue</Button>
          </div>
        </div>
      )}
    </main>
  );
}
