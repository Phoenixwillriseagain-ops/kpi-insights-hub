import { createFileRoute } from "@tanstack/react-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart3, CheckCircle2, ChevronRight, FileSpreadsheet,
  Filter, Info, Layers, LineChart as LineChartIcon, Loader2, Moon, Pin, RefreshCw,
  Sparkles, Sun, Target, TrendingUp, Upload, Users, X,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart,
  ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

import { KPI_META, KPI_ORDER, ragLabel, type KpiCode } from "@/lib/analyzer/kpi";
import type { Dataset } from "@/lib/analyzer/parseTypes";
import {
  exclusionImpact, monthLabel, monthlySummary, overallByKpi, queueBreakdown,
  rawOverallByKpi, weekLabel, weeklySummary, weeklyQueueSummary,
} from "@/lib/analyzer/compute";
import { DeferredMount } from "@/components/DeferredMount";
import { pcmsTopAgents, pcmsWeeklyCounts } from "@/lib/analyzer/pcmsAnalytics";
import type { ValidationReport, ValidationIssue, SheetMapping } from "@/lib/analyzer/validate";
import type { WorkerInput, WorkerOutput } from "@/lib/analyzer/worker";
import { PerfPanel } from "@/components/PerfPanel";
import { perfMark, perfMeasure } from "@/lib/perf";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")(
  {
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pulse · KPI & Breaches Analyzer" },
      { name: "description", content: "Modern interactive dashboard for SLA breaches: monthly trends, weekly heat, queue drill-down and exclusion crosscheck — all in your browser." },
    ],
  }),
  component: Dashboard,
}
);

type Slot = "sla" | "breach" | "excl";

type LoadedFile = { name: string; file?: File; error?: string };

function Dashboard() {
  const [files, setFiles] = useState<Record<Slot, LoadedFile[]>>({ sla: [], breach: [], excl: [] });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<KpiCode>("KSL-2c");
  const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [exclMappings, setExclMappings] = useState<SheetMapping[]>([]);
  const [override, setOverride] = useState(false);

  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    console.log("dataset changed", dataset ? {
      months: dataset.months.length,
      weeks: dataset.weeks.length,
      kpis: Object.keys(dataset.sla).length,
      pcms: dataset.pcms.length,
    } : null);
  }, [dataset]);

  const toggleTheme = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  const addFiles = useCallback(async (slot: Slot, list: FileList | File[]) => {
    const arr = Array.from(list);
    const loaded: LoadedFile[] = arr.map((f) => ({ name: f.name, file: f }));
    setFiles((s) => ({ ...s, [slot]: [...s[slot], ...loaded] }));
    setReport(null);
    setOverride(false);
    setExclMappings([]);
  }, []);

  const removeFile = (slot: Slot, idx: number) => {
    setFiles((s) => ({ ...s, [slot]: s[slot].filter((_, i) => i !== idx) }));
    setReport(null);
    setOverride(false);
    setExclMappings([]);
  };

  const canRun = files.sla.some((f) => !f.error && f.file);

  const runAnalysis = async () => {
    setBusy(true);
    perfMark("runAnalysis:start");
    try {
      const toBufs = async (items: LoadedFile[]) =>
        Promise.all(
          items.filter((f) => f.file).map(async (f) => ({
            name: f.name,
            buf: await f.file!.arrayBuffer(),
          })),
        );

      const [sla, breach, excl] = await perfMeasure("read files → ArrayBuffer", async () =>
        Promise.all([toBufs(files.sla), toBufs(files.breach), toBufs(files.excl)]),
      );

      const totalBytes = [...sla, ...breach, ...excl].reduce((n, x) => n + x.buf.byteLength, 0);
      perfMark("workbook bytes", `${(totalBytes / 1048576).toFixed(2)} MB`);

      const result = await perfMeasure("worker: parse + buildDataset", async () => {
        if (!self.crossOriginIsolated) {
          const [{ buildDataset }, { buildReport, buildExclMappings }, XLSX] = await Promise.all([
            import("@/lib/analyzer/parse"),
            import("@/lib/analyzer/validate"),
            import("xlsx"),
          ]);

          const read = (items: { name: string; buf: ArrayBuffer }[]) =>
            items.map((it) => ({
              name: it.name,
              wb: XLSX.read(it.buf, { type: "array" }),
            }));

          const slaFiles = read(sla);
          const breachFiles = read(breach);
          const exclFiles = read(excl);

          const report = buildReport(slaFiles, breachFiles, exclFiles);
          const exclMappings = buildExclMappings(exclFiles);
          const ds = buildDataset(
            slaFiles.map((f) => f.wb),
            breachFiles.map((f) => f.wb),
            exclFiles.map((f) => f.wb),
          );

          return { ok: true, report, exclMappings, ds } as WorkerOutput;
        }

        const worker = new Worker(new URL("../lib/analyzer/worker.ts", import.meta.url), { type: "module" });
        const TIMEOUT_MS = 60_000;

        try {
          return await new Promise<WorkerOutput>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Analysis timed out after 60 s — try a smaller file or reload.")),
              TIMEOUT_MS,
            );

            worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
              clearTimeout(timer);
              resolve(e.data);
            };

            worker.onerror = (e) => {
              clearTimeout(timer);
              reject(new Error(e.message || "Worker error"));
            };

            const payload: WorkerInput = { sla, breach, excl };
            const transfer = [...sla, ...breach, ...excl].map((x) => x.buf);
            worker.postMessage(payload, transfer);
          });
        } finally {
          worker.terminate();
        }
      });

      if (!result.ok) throw new Error(result.error);

      console.log("analysis result received", {
        ok: result.ok,
        reportOk: result.report?.ok,
        exclMappings: result.exclMappings?.length ?? 0,
      });

      setReport(result.report);
      setExclMappings(result.exclMappings);

      if (!result.report.ok && !override) {
        toast.error("Fix required columns before running", {
          description: "See the validation panel for details, or toggle \u201cRun anyway\u201d to bypass.",
        });
        return;
      }

      const ds = result.ds;

      console.log("dataset about to set", {
        months: ds.months.length,
        weeks: ds.weeks.length,
        kpis: Object.keys(ds.sla).length,
        pcms: ds.pcms.length,
      });

      if (!Object.keys(ds.sla).length) {
        toast.error("No KPI sheets detected", {
          description: "Sheet names should match KSL-1, KSL-2a, \u2026, KM-1, KM-2.",
        });
        return;
      }

      setDataset(ds);
      setActiveMonth(null);

      perfMark("dataset ready", `${ds.months.length}mo \u00b7 ${ds.weeks.length}wk \u00b7 ${Object.keys(ds.sla).length} KPIs`);
      toast.success("Analysis ready", {
        description: `${ds.months.length} months \u00b7 ${ds.weeks.length} weeks \u00b7 ${Object.keys(ds.sla).length} KPIs`,
      });
    } catch (e) {
      toast.error("Analysis failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDataset(null);
    setFiles({ sla: [], breach: [], excl: [] });
    setReport(null);
    setOverride(false);
    setExclMappings([]);
  };

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-right" />
      <PerfPanel />
      <Header
  onToggleTheme={toggleTheme}
  dark={dark}
  onReset={dataset ? reset : undefined}
/>

      {!dataset ? (
        <UploadHero
          files={files}
          onAdd={addFiles}
          onRemove={removeFile}
          onRun={runAnalysis}
          canRun={canRun}
          busy={busy}
          report={report}
          exclMappings={exclMappings}
          override={override}
          setOverride={setOverride}
        />
      ) : (
        <Analysis
          ds={dataset}
          month={activeMonth}
          setMonth={setActiveMonth}
          activeKpi={activeKpi}
          setActiveKpi={setActiveKpi}
        />
      )}

      <footer className="border-t border-border/50 mt-16 py-8 text-center text-xs text-muted-foreground">
        Built client-side \u00b7 Nothing leaves your browser \u00b7 Drop new files anytime
      </footer>
    </div>
  );
}

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 HEADER */

function Header({
  onToggleTheme,
  dark,
  onReset,
}: {
  onToggleTheme: () => void;
  dark: boolean;
  onReset?: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 glass border-b border-border/50">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[image:var(--gradient-primary)] ring-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-bold">Pulse</span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            KPI & Breaches Analyzer
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onReset && (
            <Button variant="ghost" size="sm" onClick={onReset} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> New analysis
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={onToggleTheme} aria-label="Toggle theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </header>
  );
}
/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 UPLOAD HERO */

const SLOT_META: Record<Slot, { title: string; desc: string; required?: boolean; icon: typeof FileSpreadsheet; accent: string }> = {
  sla:    { title: "SLA Overall",            desc: "Workbook with one sheet per KPI (KSL-1\u2026KM-2). Source of all KPI rates.", required: true, icon: FileSpreadsheet, accent: "from-[color:var(--chart-1)] to-[color:var(--primary-glow)]" },
  breach: { title: "KSL-5b Deep-dive (PCms)", desc: "Optional. Per-ticket KO/NOK reason categories \u2014 unlocks the KSL-5b Detail tab.", icon: Layers,         accent: "from-[color:var(--chart-3)] to-[color:var(--chart-4)]" },
  excl:   { title: "Exclusions register",    desc: "Optional. Extra ticket IDs to exclude on top of the per-row Excluded flag.", icon: Filter,         accent: "from-[color:var(--chart-2)] to-[color:var(--warning)]" },
};

function UploadHero({
  files, onAdd, onRemove, onRun, canRun, busy, report, exclMappings, override, setOverride,
}: {
  files: Record<Slot, LoadedFile[]>;
  onAdd: (slot: Slot, list: FileList | File[]) => void;
  onRemove: (slot: Slot, idx: number) => void;
  onRun: () => void;
  canRun: boolean;
  busy: boolean;
  report: ValidationReport | null;
  exclMappings: SheetMapping[];
  override: boolean;
  setOverride: (v: boolean) => void;
}) {
  const hasErrors = !!report && !report.ok;
  return (
    <main className="mx-auto max-w-6xl px-6 pt-12 pb-16">
      <section className="mb-12 text-center">
        <Badge variant="secondary" className="mb-4 gap-1.5 rounded-full bg-secondary/70 px-3 py-1 text-xs">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
          Runs entirely in your browser
        </Badge>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-6xl">
          See the <span className="gradient-text">pulse</span> of every SLA
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Drop the SLA overall workbook, an optional PCms KSL-5b deep-dive and an exclusions register.
          Get KPI compliance, monthly &amp; weekly trends, queue drill-down, exclusion crosscheck
          and a dedicated KSL-5b reason analysis \u2014 instantly.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {(Object.keys(SLOT_META) as Slot[]).map((slot) => (
          <UploadCard
            key={slot}
            slot={slot}
            files={files[slot]}
            onAdd={(list) => onAdd(slot, list)}
            onRemove={(i) => onRemove(slot, i)}
          />
        ))}
      </div>

      {report && <ValidationPanel report={report} override={override} setOverride={setOverride} />}
      {exclMappings.length > 0 && <ExclusionMappingPreview mappings={exclMappings} />}


      <div className="mt-10 flex flex-col items-center justify-center gap-2">
        <Button
          size="lg"
          disabled={!canRun || busy || (hasErrors && !override)}
          onClick={onRun}
          className="group h-12 rounded-full bg-[image:var(--gradient-primary)] px-8 text-base font-semibold text-primary-foreground ring-glow transition hover:opacity-95 disabled:opacity-40"
        >
          {busy
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Crunching&hellip;</>
            : <><Activity className="mr-2 h-4 w-4" /> {report ? "Re-run analysis" : "Run analysis"} <ChevronRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" /></>}
        </Button>
        {hasErrors && (
          <p className="text-[11px] text-muted-foreground">
            Fix the validation errors above or enable &ldquo;Run anyway&rdquo; to bypass.
          </p>
        )}
      </div>

      <div className="mt-12 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
        <Tip icon={Target} label="13 KPIs" body="KSL-1 through KM-2 with the right targets baked in." />
        <Tip icon={TrendingUp} label="Trends" body="Monthly and last-6-weeks views per KPI and per queue." />
        <Tip icon={Pin} label="Exclusions" body="Crosscheck before/after exclusion impact at a glance." />
      </div>
    </main>
  );
}

function Tip({ icon: Icon, label, body }: { icon: typeof Target; label: string; body: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-1.5 flex items-center gap-2 text-foreground">
        <Icon className="h-4 w-4 text-primary" />
        <span className="font-semibold">{label}</span>
      </div>
      <p>{body}</p>
    </div>
  );
}

function ValidationPanel({ report, override, setOverride }: { report: ValidationReport; override: boolean; setOverride: (v: boolean) => void }) {
  const errors = report.issues.filter((i) => i.severity === "error");
  const warns = report.issues.filter((i) => i.severity === "warn");
  const infos = report.issues.filter((i) => i.severity === "info");
  if (report.ok && warns.length === 0) {
    return (
      <div className="mt-8 glass flex items-center gap-3 rounded-2xl border border-[color:var(--success)]/30 bg-[color:var(--success)]/5 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
        <span className="font-semibold text-[color:var(--success)]">Looks good</span>
        <span className="text-muted-foreground">All required columns detected.</span>
      </div>
    );
  }
  const tone = errors.length
    ? "border-[color:var(--danger)]/40 bg-[color:var(--danger)]/5"
    : "border-[color:var(--warning)]/40 bg-[color:var(--warning)]/5";
  return (
    <section className={cn("mt-8 glass rounded-2xl border", tone)} aria-label="Upload validation">
      <header className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        {errors.length
          ? <AlertTriangle className="h-4 w-4 text-[color:var(--danger)]" />
          : <Info className="h-4 w-4 text-[color:var(--warning)]" />}
        <h3 className="text-sm font-bold">
          Validation \u00b7 {errors.length} error{errors.length === 1 ? "" : "s"} \u00b7 {warns.length} warning{warns.length === 1 ? "" : "s"}
        </h3>
        {errors.length > 0 && (
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="h-3.5 w-3.5 accent-[color:var(--primary)]"
            />
            Run anyway
          </label>
        )}
      </header>
      <ul className="max-h-72 divide-y divide-border/40 overflow-y-auto">
        {[...errors, ...warns, ...infos].map((iss, i) => (
          <IssueRow key={i} issue={iss} />
        ))}
      </ul>
    </section>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const color = issue.severity === "error" ? "var(--danger)" : issue.severity === "warn" ? "var(--warning)" : "var(--primary)";
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-xs">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="truncate">
          <span className="font-semibold text-foreground">{issue.file}</span>
          {issue.sheet && <span className="text-muted-foreground"> \u00b7 sheet &ldquo;{issue.sheet}&rdquo;</span>}
        </p>
        <p style={{ color }}>{issue.message}</p>
        {issue.hint && <p className="text-muted-foreground">{issue.hint}</p>}
      </div>
    </li>
  );
}

function ExclusionMappingPreview({ mappings }: { mappings: SheetMapping[] }) {
  return (
    <section
      className="mt-6 glass rounded-2xl border border-border/40"
      aria-label="Exclusion column mapping preview"
    >
      <header className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">Exclusion column mapping</h3>
        <span className="text-xs text-muted-foreground">
          Rename the highlighted headers in your file to the canonical names below.
        </span>
      </header>
      <div className="max-h-80 space-y-4 overflow-y-auto p-4">
        {mappings.map((m, i) => (
          <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-3">
            <p className="mb-2 text-xs font-semibold">
              <span className="text-foreground">{m.file}</span>
              <span className="text-muted-foreground"> \u00b7 sheet &ldquo;{m.sheet}&rdquo;</span>
            </p>
            <div className="overflow-hidden rounded-lg border border-border/40">
              <table className="w-full text-xs">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Required</th>
                    <th className="px-3 py-2 text-left font-semibold">Your header</th>
                    <th className="px-3 py-2 text-left font-semibold">Suggested rename</th>
                    <th className="px-3 py-2 text-right font-semibold">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((r, j) => {
                    const tone =
                      r.status === "ok" ? "var(--success)" :
                      r.status === "rename" ? "var(--warning)" : "var(--danger)";
                    return (
                      <tr key={j} className="border-t border-border/40">
                        <td className="px-3 py-2 font-medium">{r.required}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.candidate ? <code className="rounded bg-secondary/60 px-1.5 py-0.5">{r.candidate}</code> : <span className="italic">\u2014 not found \u2014</span>}
                        </td>
                        <td className="px-3 py-2">
                          {r.status === "ok"
                            ? <span className="text-[color:var(--success)]">No change needed</span>
                            : r.status === "rename"
                              ? <span>Rename to <code className="rounded bg-[color:var(--warning)]/15 px-1.5 py-0.5 text-[color:var(--warning)]">{r.canonical}</code></span>
                              : <span>Add column <code className="rounded bg-[color:var(--danger)]/15 px-1.5 py-0.5 text-[color:var(--danger)]">{r.canonical}</code></span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className="inline-block min-w-12 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: `color-mix(in oklab, ${tone} 15%, transparent)`, color: tone }}
                          >
                            {Math.round(r.score * 100)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UploadCard({ slot, files, onAdd, onRemove }: {
  slot: Slot;
  files: LoadedFile[];
  onAdd: (list: FileList | File[]) => void;
  onRemove: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const meta = SLOT_META[slot];
  const Icon = meta.icon;

  return (
    <div className="glass relative overflow-hidden rounded-3xl p-6 ring-soft transition hover:translate-y-[-2px]">
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", meta.accent)} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h3 className="font-display text-sm font-bold">{meta.title}</h3>
            {meta.required ? <Badge className="bg-primary/10 text-primary hover:bg-primary/10">required</Badge> : <Badge variant="secondary">optional</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{meta.desc}</p>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label={`Upload ${meta.title} workbook. Drop an Excel file or press Enter to browse.`}
        aria-describedby={`drop-help-${slot}`}
        onClick={() => ref.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ref.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) onAdd(e.dataTransfer.files); }}
        className={cn(
          "mt-4 cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition outline-none",
          "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40",
          drag ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/60 hover:bg-secondary/40",
        )}
      >
        <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-semibold">Drop .xlsx here</p>
        <p id={`drop-help-${slot}`} className="text-[11px] text-muted-foreground">or click to browse</p>
        <input
          ref={ref}
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="sr-only"
          aria-label={`${meta.title} file input`}
          tabIndex={-1}
          onChange={(e) => { if (e.target.files?.length) { onAdd(e.target.files); e.currentTarget.value = ""; } }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={`Uploaded ${meta.title} files`}>
          {files.map((f, i) => (
            <li key={i} className={cn(
              "flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-xs",
              f.error && "border-destructive/40 bg-destructive/5",
            )}>
              <span aria-hidden="true" className={cn("font-semibold", f.error ? "text-destructive" : "text-[color:var(--success)]")}>{f.error ? "!" : "\u2713"}</span>
              <span className="sr-only">{f.error ? `Error: ${f.error}` : "Loaded"}</span>
              <span className="flex-1 truncate" title={f.name}>{f.name}</span>
              <button
                onClick={() => onRemove(i)}
                aria-label={`Remove ${f.name}`}
                className="rounded text-muted-foreground transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 ANALYSIS */

/**
 * Keeps track of which tabs have ever been activated so we can mount their
 * content lazily (only on first visit) and keep it mounted after that to
 * avoid re-render costs on every tab switch.
 */

function Analysis({
  ds, month, setMonth, activeKpi, setActiveKpi,
}: {
  ds: Dataset;
  month: string | null;
  setMonth: (m: string | null) => void;
  activeKpi: KpiCode;
  setActiveKpi: (k: KpiCode) => void;
}) {
  const detectedKpis = useMemo(
    () => KPI_ORDER.filter((c) => ds.sla[c]?.length),
    [ds],
  );

const [activeTab, setActiveTab] = useState<string>("overview");

useEffect(() => {
  console.log("dataset diagnostics", {
    months: ds.months,
    weeks: ds.weeks,
    slaKeys: Object.keys(ds.sla),
    pcmsRows: ds.pcms.length,
    ksl5bRows: ds.sla["KSL-5b"]?.length ?? 0,
  });
}, [ds]);

return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div
        className="mb-6 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by period"
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Period</span>
        <Chip active={month === null} onClick={() => setMonth(null)} label="All months">All months</Chip>
        {ds.months.map((m) => (
          <Chip key={m} active={month === m} onClick={() => setMonth(m)} label={monthLabel(m)}>
            {monthLabel(m)}
          </Chip>
        ))}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          perfMark("tab switch", `${activeTab} \u2192 ${v}`);
          setActiveTab(v);
        }}
        className="space-y-6"
      >
        <TabsList className="glass h-12 w-full justify-start gap-1 rounded-2xl p-1.5">
          <TabTrigger value="overview" icon={BarChart3}>Overview</TabTrigger>
          <TabTrigger value="monthly" icon={LineChartIcon}>Monthly Trend</TabTrigger>
          <TabTrigger value="weekly" icon={Activity}>Weekly Trend</TabTrigger>
          <TabTrigger value="queues" icon={Layers}>Queue Analysis</TabTrigger>
          <TabTrigger value="excl" icon={Filter}>Exclusion Impact</TabTrigger>
          <TabTrigger value="quality" icon={CheckCircle2}>KSL-4 &amp; KM-1</TabTrigger>
          {ds.pcms.length > 0 && <TabTrigger value="ksl5b" icon={Users}>KSL-5b Detail</TabTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
  {activeTab === "overview" && <OverviewSection ds={ds} month={month} detected={detectedKpis} />}
</TabsContent>
<TabsContent value="monthly" className="space-y-6">
  {activeTab === "monthly" && <MonthlySection ds={ds} detected={detectedKpis} />}
</TabsContent>
<TabsContent value="weekly" className="space-y-6">
  {activeTab === "weekly" && <WeeklySection ds={ds} detected={detectedKpis} />}
</TabsContent>
<TabsContent value="queues" className="space-y-6">
  {activeTab === "queues" && <QueuesSection ds={ds} month={month} detected={detectedKpis} activeKpi={activeKpi} setActiveKpi={setActiveKpi} />}
</TabsContent>
<TabsContent value="excl" className="space-y-6">
  {activeTab === "excl" && <ExclusionSection ds={ds} month={month} detected={detectedKpis} />}
</TabsContent>
<TabsContent value="quality" className="space-y-6">
  {activeTab === "quality" && <QualityReopenSection ds={ds} month={month} detected={detectedKpis} />}
</TabsContent>
{ds.pcms.length > 0 && (
  <TabsContent value="ksl5b" className="space-y-6">
    {activeTab === "ksl5b" && <Ksl5bDetail ds={ds} month={month} />}
  </TabsContent>
)}
      </Tabs>
    </main>
  );
}
function Chip({ children, active, onClick, label }: { children: React.ReactNode; active: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "border-transparent bg-[image:var(--gradient-primary)] text-primary-foreground ring-glow"
          : "border-border/70 bg-card/60 text-foreground hover:border-primary/60 hover:text-primary",
      )}
    >{children}</button>
  );
}

function TabTrigger({ value, icon: Icon, children }: { value: string; icon: typeof BarChart3; children: React.ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      className="gap-1.5 rounded-xl px-4 data-[state=active]:bg-[image:var(--gradient-primary)] data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
    >
      <Icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{children}</span>
    </TabsTrigger>
  );
}



/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 OVERVIEW */

const OverviewSection = React.memo(function OverviewSection({ ds, month, detected }: { ds: Dataset; month: string | null; detected: KpiCode[] }) {
  const totals = useMemo(() => {
    let total = 0, breaches = 0, excluded = 0;
    detected.forEach((c) => {
      const imp = exclusionImpact(ds, c, month);
      total += imp.rawTotal; breaches += imp.rawBreaches; excluded += imp.excluded;
    });
    const passingKpis = detected.filter((c) => overallByKpi(ds, c, month).rag === "green").length;
    return { total, breaches, excluded, passingKpis };
  }, [ds, month, detected]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBlock label="Tickets evaluated" value={totals.total.toLocaleString()} icon={FileSpreadsheet} accent="primary" />
        <StatBlock label="Breaches" value={totals.breaches.toLocaleString()} sub={totals.total ? ((totals.breaches / totals.total) * 100).toFixed(1) + "% of total" : "\u2014"} icon={TrendingUp} accent="danger" />
        <StatBlock label="Excluded" value={totals.excluded.toLocaleString()} sub={totals.total ? ((totals.excluded / totals.total) * 100).toFixed(1) + "% removed" : "\u2014"} icon={Filter} accent="warning" />
        <StatBlock label="KPIs on target" value={`${totals.passingKpis} / ${detected.length}`} icon={Target} accent="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {detected.map((code) => <KpiTile key={code} ds={ds} code={code} month={month} />)}
      </div>
    </>
  );
});

function StatBlock({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: typeof Target; accent: "primary" | "success" | "warning" | "danger";
}) {
  const ring = {
    primary: "from-[color:var(--primary)]/20 to-[color:var(--primary-glow)]/10 text-primary",
    success: "from-[color:var(--success)]/20 to-transparent text-[color:var(--success)]",
    warning: "from-[color:var(--warning)]/20 to-transparent text-[color:var(--warning)]",
    danger:  "from-[color:var(--danger)]/20 to-transparent text-[color:var(--danger)]",
  }[accent];
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5 ring-soft">
      <div className={cn("absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br opacity-60 blur-xl", ring)} />
      <div className="relative flex items-start gap-3">
        <div className={cn("rounded-xl bg-secondary/60 p-2", ring)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
          {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

const KpiTile = React.memo(function KpiTile({ ds, code, month }: { ds: Dataset; code: KpiCode; month: string | null }) {
  const meta = KPI_META[code];
  const { after, before, trend, delta, excludedCount } = useMemo(() => {
    const a = overallByKpi(ds, code, month);
    const b = rawOverallByKpi(ds, code, month);
    return {
      after: a,
      before: b,
      trend: weeklySummary(ds, code, { lastN: 6 }),
      delta: a.rate - b.rate,
      excludedCount: b.total - a.total,
    };
  }, [ds, code, month]);
  const colorFor = (rag: string) => rag === "green" ? "var(--success)" : rag === "amber" ? "var(--warning)" : rag === "red" ? "var(--danger)" : undefined;


  return (
    <div className="glass group relative flex flex-col gap-3 overflow-hidden rounded-2xl p-5 transition hover:translate-y-[-2px] hover:ring-glow">
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: meta.color }} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>{code}</p>
          <p className="mt-0.5 text-xs font-semibold leading-tight text-foreground">{meta.what}</p>
        </div>
        <RagBadge rag={after.rag} isKM={meta.isKM} />
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary/40 p-2.5">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Before excl.</p>
          <p className="font-display text-xl font-bold tabular-nums" style={{ color: colorFor(before.rag) }}>{before.display}</p>
          <p className="text-[10px] text-muted-foreground">{before.total.toLocaleString()} tickets</p>
        </div>
        <div className="border-l border-border/60 pl-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">After excl.</p>
          <p className="font-display text-xl font-bold tabular-nums" style={{ color: colorFor(after.rag) }}>{after.display}</p>
          <p className="text-[10px] text-muted-foreground">{after.total.toLocaleString()} tickets</p>
        </div>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="text-[10px] text-muted-foreground">
          <p>Target {meta.targetLabel}</p>
          {excludedCount > 0 && (
            <p className="inline-flex items-center gap-1">
              {excludedCount.toLocaleString()} excluded \u00b7
              {delta > 0
                ? <ArrowUp className="h-3 w-3 text-[color:var(--success)]" />
                : delta < 0
                ? <ArrowDown className="h-3 w-3 text-[color:var(--danger)]" />
                : null}
              <span>{Math.abs(delta).toFixed(1)}pp</span>
            </p>
          )}
        </div>
        <div className="h-10 w-24" aria-hidden="true">
          {trend.length > 1 ? (
            <Sparkline data={trend} color={meta.color} gradientId={`spark-${code}`} />
          ) : <div className="h-full rounded bg-secondary/40" />}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{after.breaches.toLocaleString()} breaches (after)</span>
        <span>{before.breaches.toLocaleString()} (before)</span>
      </div>
    </div>
  );
});

function Sparkline({ data, color, gradientId }: { data: Array<{ rate: number }>; color: string; gradientId: string }) {
  const points = useMemo(() => {
    const w = 96;
    const h = 40;
    const pad = 3;
    const values = data.map((d) => d.rate).filter((v) => Number.isFinite(v));
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 100;
    const span = Math.max(max - min, 1);
    return data.map((d, i) => {
      const x = data.length === 1 ? w / 2 : pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - ((d.rate - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }, [data]);

  const area = points ? `0,40 ${points} 96,40` : "";
  return (
    <svg className="pointer-events-none h-full w-full" viewBox="0 0 96 40" focusable="false" role="presentation">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <polygon points={area} fill={`url(#${gradientId})`} />}
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function RagBadge({ rag, isKM }: { rag: "green" | "amber" | "red" | "none"; isKM: boolean }) {
  if (rag === "none") return <Badge variant="secondary" className="text-[10px]">no data</Badge>;
  const map = {
    green: "bg-[color:var(--success)]/15 text-[color:var(--success)] border-[color:var(--success)]/30",
    amber: "bg-[color:var(--warning)]/15 text-[color:var(--warning)] border-[color:var(--warning)]/30",
    red:   "bg-[color:var(--danger)]/15  text-[color:var(--danger)]  border-[color:var(--danger)]/30",
  }[rag];
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide", map)}>{ragLabel(rag, isKM)}</span>;
}

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 MONTHLY */

const MonthlySection = React.memo(function MonthlySection({ ds, detected }: { ds: Dataset; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const data = withDeltas(monthlySummary(ds, code).map((p) => ({ ...p, label: monthLabel(p.label) })));
        const amber = amberBound(meta);
        return (
          <Panel key={code} title={code} subtitle={meta.what} badge={meta.targetLabel}>
            {data.length === 0
              ? <Empty message="No monthly data for this KPI." />
              : (
                <ChartFrame height={240}>{(width) => (
                  <LineChart width={width} height={240} data={data} margin={{ top: 18, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
                    <Tooltip content={<RichTip meta={meta} />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                    <ReferenceLine
                      y={meta.target}
                      stroke="var(--success)"
                      strokeDasharray="5 4"
                      ifOverflow="extendDomain"
                      label={{ value: `target ${meta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "insideTopRight" }}
                    />
                    <ReferenceLine
                      y={amber}
                      stroke="var(--warning)"
                      strokeDasharray="2 4"
                      ifOverflow="extendDomain"
                      label={{ value: meta.isKM ? "watch ceiling" : "watch floor", fontSize: 10, fill: "var(--warning)", position: "insideBottomRight" }}
                    />
                    <Line type="monotone" dataKey="rate" stroke={meta.color} strokeWidth={2.5} isAnimationActive={false}
                      dot={(props: any) => {
                        const { cx, cy, payload, index } = props;
                        const c = payload.rag === "green" ? "var(--success)" : payload.rag === "amber" ? "var(--warning)" : payload.rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
                        return <circle key={index} cx={cx} cy={cy} r={4} fill={c} stroke={meta.color} strokeWidth={1.5} />;
                      }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                )}</ChartFrame>
              )}
          </Panel>
        );
      })}
    </div>
  );
});

/* ____ WEEKLY */

const WeeklySection = React.memo(function WeeklySection({ ds, detected }: { ds: Dataset; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const data = weeklySummary(ds, code, { lastN: 12 }).map((p) => ({ ...p, label: weekLabel(p.label) }));
        const amber = amberBound(meta);
        return (
          <Panel key={code} title={code} subtitle={meta.what} badge={meta.targetLabel}>
            {data.length === 0
              ? <Empty message="No weekly data for this KPI." />
              : (
                <ChartFrame height={200}>{(width) => (
                  <ComposedChart width={width} height={200} data={data} margin={{ top: 14, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
                    <Tooltip content={<RichTip meta={meta} />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                    <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain" />
                    <ReferenceLine y={amber} stroke="var(--warning)" strokeDasharray="2 4" ifOverflow="extendDomain" />
                    <Bar dataKey="total" fill="var(--muted-foreground)" opacity={0.12} radius={[2, 2, 0, 0]} yAxisId={0} />
                    <Line type="monotone" dataKey="rate" stroke={meta.color} strokeWidth={2} isAnimationActive={false}
                      dot={(props: any) => {
                        const { cx, cy, payload, index } = props;
                        const c = payload.rag === "green" ? "var(--success)" : payload.rag === "amber" ? "var(--warning)" : payload.rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
                        return <circle key={index} cx={cx} cy={cy} r={3} fill={c} stroke={meta.color} strokeWidth={1.5} />;
                      }}
                    />
                  </ComposedChart>
                )}</ChartFrame>
              )}
          </Panel>
        );
      })}
    </div>
  );
});

/* ________QUEUES */

const QueuesSection = React.memo(function QueuesSection({
  ds, month, detected, activeKpi, setActiveKpi,
}: {
  ds: Dataset;
  month: string | null;
  detected: KpiCode[];
  activeKpi: KpiCode;
  setActiveKpi: (k: KpiCode) => void;
}) {
const safeKpi: KpiCode = detected.includes(activeKpi) ? activeKpi : (detected[0] ?? "KSL-2c");
const meta = KPI_META[safeKpi];

// 1\ufe0f\u20e3 rows first \u2014 no dependencies on the others
const rows = useMemo(() => queueBreakdown(ds, safeKpi, month), [ds, safeKpi, month]);

// 2\ufe0f\u20e3 topQueues second \u2014 depends on rows
const topQueues = useMemo(() => {
  const sorted = [...rows].sort((a, b) => b.breaches - a.breaches);
  return sorted.slice(0, 5).map((r) => r.queue);
}, [rows]);

// 3\ufe0f\u20e3 weekRows third \u2014 depends on topQueues (must come AFTER)
const weekRows = useMemo(() => {
  const allWeeks = new Set<string>();
  const queueData: Record<string, Record<string, number>> = {};

  topQueues.forEach((q) => {
    const pts = weeklyQueueSummary(ds, safeKpi, q, { lastN: 12 });
    queueData[q] = {};
    pts.forEach((p) => {
      allWeeks.add(p.label);
      queueData[q][p.label] = p.rate;
    });
  });

  return [...allWeeks].sort().map((week) => ({
    week,
    queues: topQueues.map((q) => ({
      queue: q,
      rate: queueData[q][week] ?? null,
    })),
  }));
}, [ds, safeKpi, topQueues]);

// 4\ufe0f\u20e3 chartData last \u2014 depends on weekRows + topQueues
const chartData = useMemo(() => {
  return weekRows.map((w) => {
    const entry: Record<string, unknown> = { label: weekLabel(w.week) };
    topQueues.forEach((q) => {
      const found = w.queues.find((x) => x.queue === q);
      entry[q] = found?.rate ?? null;
    });
    return entry;
  });
}, [weekRows, topQueues]);

  const QUEUE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">KPI</span>
        <Select value={safeKpi} onValueChange={(v) => setActiveKpi(v as KpiCode)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {detected.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">{c} \u00b7 {KPI_META[c].what}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <Empty message="No queue breakdown available for this KPI / period." />
      ) : (
        <>
          <Panel title="Queue Breach Table" subtitle={`${meta.what} \u00b7 ${month ? monthLabel(month) : "all months"}`} badge={meta.targetLabel}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Queue</TableHead>
                    <TableHead className="text-right">Tickets</TableHead>
                    <TableHead className="text-right">Breaches</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">vs target</TableHead>
                    <TableHead>RAG</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const diff = r.rate - meta.target;
                    const diffLabel = (meta.isKM ? -diff : diff) > 0
                      ? <span className="text-[color:var(--success)]">+{Math.abs(diff).toFixed(1)}pp</span>
                      : <span className="text-[color:var(--danger)]">\u2212{Math.abs(diff).toFixed(1)}pp</span>;
                    return (
                      <TableRow key={r.queue}>
                        <TableCell className="font-medium">{r.queue}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.breaches.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{r.rate.toFixed(1)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{diffLabel}</TableCell>
                        <TableCell><RagBadge rag={r.rag} isKM={meta.isKM} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>

          {chartData.length > 0 && topQueues.length > 0 && (
            <Panel title="Weekly Rate by Queue" subtitle={`Top ${topQueues.length} queues by breach volume`}>
              <ChartFrame height={260}>{(width) => (
                <LineChart width={width} height={260} data={chartData} margin={{ top: 14, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`]} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                  <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {topQueues.map((q, i) => (
                    <Line
                      key={q}
                      type="monotone"
                      dataKey={q}
                      stroke={QUEUE_COLORS[i % QUEUE_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              )}</ChartFrame>
            </Panel>
          )}
        </>
      )}
    </>
  );
});

/* \_________________________________EXCLUSION */

const ExclusionSection = React.memo(function ExclusionSection({ ds, month, detected }: { ds: Dataset; month: string | null; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const imp = exclusionImpact(ds, code, month);
        const delta = imp.adjustedRate - imp.rawRate;
        const data = [
          { name: "Raw (before)", rate: imp.rawRate, breaches: imp.rawBreaches, total: imp.rawTotal, rag: imp.rawRag },
          { name: "Adjusted (after)", rate: imp.adjustedRate, breaches: imp.adjustedBreaches, total: imp.adjustedTotal, rag: imp.adjustedRag },
        ];
        return (
          <Panel key={code} title={code} subtitle={meta.what} badge={meta.targetLabel}>
            {imp.rawTotal === 0
              ? <Empty message="No data for this KPI / period." />
              : (
                <>
                  <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{imp.excluded.toLocaleString()} tickets excluded</span>
                    <span>\u00b7</span>
                    <span className={delta >= 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(1)}pp impact
                    </span>
                  </div>
                  <ChartFrame height={160}>{(width) => (
                    <BarChart width={width} height={160} data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
                      <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`]} />
                      <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain" />
                      <Bar dataKey="rate" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {data.map((entry, index) => (
                          <rect
                            key={index}
                            fill={entry.rag === "green" ? "var(--success)" : entry.rag === "amber" ? "var(--warning)" : "var(--danger)"}
                          />
                        ))}
                        <LabelList dataKey="rate" position="top" formatter={(v: number) => `${v.toFixed(1)}%`} style={{ fontSize: 11, fill: "var(--foreground)" }} />
                      </Bar>
                    </BarChart>
                  )}</ChartFrame>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    {data.map((d) => (
                      <div key={d.name} className="rounded-lg bg-secondary/40 p-2">
                        <p className="font-semibold text-muted-foreground">{d.name}</p>
                        <p className="tabular-nums">{d.rate.toFixed(1)}% \u00b7 {d.breaches.toLocaleString()} breaches</p>
                        <p className="text-muted-foreground">{d.total.toLocaleString()} tickets</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
          </Panel>
        );
      })}
    </div>
  );
});

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 QUALITY / REOPEN */

const QualityReopenSection = React.memo(function QualityReopenSection({ ds, month, detected }: { ds: Dataset; month: string | null; detected: KpiCode[] }) {
  const qualityCodes = detected.filter((c) => ["KSL-4", "KM-1"].includes(c));
  if (qualityCodes.length === 0) {
    return <Empty message="No KSL-4 or KM-1 data detected in the uploaded workbook." />;
  }
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {qualityCodes.map((code) => {
        const meta = KPI_META[code];
        const data = withDeltas(monthlySummary(ds, code).map((p) => ({ ...p, label: monthLabel(p.label) })));
        const amber = amberBound(meta);
        return (
          <Panel key={code} title={code} subtitle={meta.what} badge={meta.targetLabel}>
            {data.length === 0
              ? <Empty message={`No data for ${code}.`} />
              : (
                <ChartFrame height={240}>{(width) => (
                  <ComposedChart width={width} height={240} data={data} margin={{ top: 18, right: 24, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
                    <Tooltip content={<RichTip meta={meta} />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                    <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain"
                      label={{ value: `target ${meta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "insideTopRight" }} />
                    <ReferenceLine y={amber} stroke="var(--warning)" strokeDasharray="2 4" ifOverflow="extendDomain"
                      label={{ value: meta.isKM ? "watch ceiling" : "watch floor", fontSize: 10, fill: "var(--warning)", position: "insideBottomRight" }} />
                    <Bar dataKey="total" fill="var(--muted-foreground)" opacity={0.12} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    <Line type="monotone" dataKey="rate" stroke={meta.color} strokeWidth={2.5} isAnimationActive={false}
                      dot={(props: any) => {
                        const { cx, cy, payload, index } = props;
                        const c = payload.rag === "green" ? "var(--success)" : payload.rag === "amber" ? "var(--warning)" : payload.rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
                        return <circle key={index} cx={cx} cy={cy} r={4} fill={c} stroke={meta.color} strokeWidth={1.5} />;
                      }}
                      activeDot={{ r: 6 }}
                    />
                  </ComposedChart>
                )}</ChartFrame>
              )}
          </Panel>
        );
      })}
    </div>
  );
});

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 KSL-5b */

const Ksl5bDetail = React.memo(function Ksl5bDetail({ ds, month }: { ds: Dataset; month: string | null }) {
  const counts = useMemo(() => pcmsWeeklyCounts(ds, month), [ds, month]);
  const topAgents = useMemo(() => pcmsTopAgents(ds, month, 10), [ds, month]);

  if (counts.length === 0 && topAgents.length === 0) {
    return <Empty message="No KSL-5b / PCms data found. Upload the PCms workbook in the Breach slot." />;
  }

  return (
    <div className="space-y-6">
      {counts.length > 0 && (
        <Panel title="Weekly KO/NOK Reason Counts" subtitle="From PCms deep-dive file">
          <ChartFrame height={260}>{(width) => {
            const cats = Array.from(new Set(counts.flatMap((w) => w.categories.map((c) => c.category)))).slice(0, 6);
            const data = counts.map((w) => {
              const e: Record<string, unknown> = { label: weekLabel(w.week) };
              cats.forEach((cat) => {
                const found = w.categories.find((c) => c.category === cat);
                e[cat] = found?.count ?? 0;
              });
              return e;
            });
            const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
            return (
              <BarChart width={width} height={260} data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {cats.map((cat, i) => (
                  <Bar key={cat} dataKey={cat} stackId="a" fill={COLORS[i % COLORS.length]} isAnimationActive={false} radius={i === cats.length - 1 ? [2, 2, 0, 0] : undefined} />
                ))}
              </BarChart>
            );
          }}</ChartFrame>
        </Panel>
      )}

      {topAgents.length > 0 && (
        <Panel title="Top 10 Agents by KO Tickets" subtitle="From PCms deep-dive file">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">KO Tickets</TableHead>
                  <TableHead className="text-right">NOK Tickets</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topAgents.map((a, i) => (
                  <TableRow key={a.agent}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{a.agent}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.koCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.nokCount.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{(a.koCount + a.nokCount).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}

      {topAgents.length > 0 && (
        <Panel title="KO vs NOK Distribution" subtitle="Top 10 agents">
          <ChartFrame height={220}>{(width) => (
            <BarChart width={width} height={220} data={topAgents.map((a) => ({ name: a.agent, KO: a.koCount, NOK: a.nokCount }))} margin={{ top: 10, right: 24, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="KO" fill="var(--danger)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="NOK" fill="var(--warning)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          )}</ChartFrame>
        </Panel>
      )}
    </div>
  );
});

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 SHARED UI */

function Panel({ title, subtitle, badge, children }: { title: string; subtitle?: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-bold">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {badge && <Badge variant="outline" className="text-[10px]">{badge}</Badge>}
      </div>
      {children}
    </div>
  );
}

function ChartFrame({ height, children }: { height: number; children: (width: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: "100%", height }} className="overflow-hidden">
      {children(width)}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

function RichTip({ meta, active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const color = d.rag === "green" ? "var(--success)" : d.rag === "amber" ? "var(--warning)" : d.rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
  return (
    <div className="glass min-w-36 rounded-xl border border-border/60 p-3 text-xs shadow-lg">
      <p className="mb-1 font-bold">{label}</p>
      <p style={{ color }} className="font-semibold tabular-nums">{d.rate?.toFixed(1)}%</p>
      <p className="text-muted-foreground">{d.total?.toLocaleString()} tickets</p>
      <p className="text-muted-foreground">{d.breaches?.toLocaleString()} breaches</p>
      {d.delta !== undefined && d.delta !== 0 && (
        <p className={d.delta > 0 ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"}>
          {d.delta > 0 ? "\u25b2" : "\u25bc"} {Math.abs(d.delta).toFixed(1)}pp vs prev
        </p>
      )}
      <p className="mt-1 border-t border-border/40 pt-1 text-[10px] text-muted-foreground">
        Target {meta.targetLabel}
      </p>
    </div>
  );
}

/* helpers */
function amberBound(meta: (typeof KPI_META)[KpiCode]): number {
  return meta.isKM
    ? meta.target * 1.1
    : meta.target * 0.97;
}

function withDeltas<T extends { rate: number }>(data: T[]): (T & { delta?: number })[] {
  return data.map((d, i) => ({
    ...d,
    delta: i === 0 ? undefined : d.rate - data[i - 1].rate,
  }));
}

/* \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 KSL-5b PCMS CHART */

function PcmsWeeklyChart({ counts }: { counts: ReturnType<typeof pcmsWeeklyCounts> }) {
  const cats = Array.from(new Set(counts.flatMap((w) => w.categories.map((c) => c.category)))).slice(0, 6);
  const data = counts.map((w) => {
    const e: Record<string, unknown> = { label: weekLabel(w.week) };
    cats.forEach((cat) => {
      const found = w.categories.find((c) => c.category === cat);
      e[cat] = found?.count ?? 0;
    });
    return e;
  });
  const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
  return (
    <ChartFrame height={260}>{(width) => (
      <BarChart width={width} height={260} data={data} margin={{ top: 10, right: 24, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
        <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {cats.map((cat, i) => (
          <Bar key={cat} dataKey={cat} stackId="a" fill={COLORS[i % COLORS.length]} isAnimationActive={false}
            radius={i === cats.length - 1 ? [2, 2, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    )}</ChartFrame>
  );
}

function PcmsAgentChart({ agents }: { agents: ReturnType<typeof pcmsTopAgents> }) {
  return (
    <ChartFrame height={220}>{(width) => (
      <BarChart
        width={width} height={220}
        data={agents.map((a) => ({ name: a.agent, KO: a.koCount, NOK: a.nokCount }))}
        margin={{ top: 10, right: 24, left: 0, bottom: 40 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} angle={-30} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="KO"  fill="var(--danger)"  radius={[2, 2, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="NOK" fill="var(--warning)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    )}</ChartFrame>
  );
}

function AgentTable({ agents }: { agents: ReturnType<typeof pcmsTopAgents> }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">KO Tickets</TableHead>
            <TableHead className="text-right">NOK Tickets</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((a, i) => (
            <TableRow key={a.agent}>
              <TableCell className="text-muted-foreground">{i + 1}</TableCell>
              <TableCell className="font-medium">{a.agent}</TableCell>
              <TableCell className="text-right tabular-nums">{a.koCount.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{a.nokCount.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{(a.koCount + a.nokCount).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CategoryBreakdownList({ counts }: { counts: Array<{ category: string; count: number }> }) {
  return (
    <div className="space-y-1">
      {counts.map(({ category: cat, count }) => (
        <p key={cat} className="flex items-center gap-1.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-muted-foreground" />
          <span className="font-medium">{cat}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}
