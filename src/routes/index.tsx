import { createFileRoute } from "@tanstack/react-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart3, CheckCircle2, ChevronRight, Download, FileSpreadsheet,
  Filter, Info, Layers, LineChart as LineChartIcon, Loader2, Moon, Pin, RefreshCw,
  Sparkles, Sun, Target, TrendingUp, Upload, Users, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

import { KPI_META, KPI_ORDER, ragLabel, type KpiCode } from "@/lib/analyzer/kpi";
import {
  buildDataset, readWorkbook, type Dataset,
} from "@/lib/analyzer/parse";
import {
  exclusionImpact, monthLabel, monthlySummary, overallByKpi, queueBreakdown,
  rawOverallByKpi, weekLabel, weeklySummary, weeklyQueueSummary,
} from "@/lib/analyzer/compute";
import { exportDatasetWorkbook } from "@/lib/analyzer/export";
import { ExportMenu } from "@/components/ExportMenu";
import { DeferredMount } from "@/components/DeferredMount";
import { PCMS_CATEGORIES, pcmsTopAgents, pcmsWeeklyCounts } from "@/lib/analyzer/parsePcms";
import { buildReport, buildExclMappings, type ValidationReport, type ValidationIssue, type SheetMapping } from "@/lib/analyzer/validate";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pulse · KPI & Breaches Analyzer" },
      { name: "description", content: "Modern interactive dashboard for SLA breaches: monthly trends, weekly heat, queue drill-down and exclusion crosscheck — all in your browser." },
    ],
  }),
  component: Dashboard,
});

type Slot = "sla" | "breach" | "excl";

type LoadedFile = { name: string; wb?: import("xlsx").WorkBook; error?: string };

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

  const toggleTheme = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      return next;
    });
  };

  const addFiles = useCallback(async (slot: Slot, list: FileList | File[]) => {
    const arr = Array.from(list);
    const loaded: LoadedFile[] = await Promise.all(
      arr.map(async (f) => {
        try { return { name: f.name, wb: await readWorkbook(f) }; }
        catch (e) { return { name: f.name, error: e instanceof Error ? e.message : "Failed to read" }; }
      }),
    );
    setFiles((s) => ({ ...s, [slot]: [...s[slot], ...loaded] }));
    setReport(null); setOverride(false); setExclMappings([]);
  }, []);

  const removeFile = (slot: Slot, idx: number) => {
    setFiles((s) => ({ ...s, [slot]: s[slot].filter((_, i) => i !== idx) }));
    setReport(null); setOverride(false); setExclMappings([]);
  };

  const canRun = files.sla.some((f) => !f.error);

  const runAnalysis = async () => {
    setBusy(true);
    // let the spinner paint before we burn the main thread
    const yieldToBrowser = () => new Promise<void>((r) =>
      requestAnimationFrame(() => setTimeout(r, 0)),
    );
    try {
      await yieldToBrowser();
      const rep = buildReport(
        files.sla.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb })),
        files.breach.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb })),
        files.excl.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb })),
      );
      setReport(rep);
      setExclMappings(buildExclMappings(files.excl.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb }))));
      if (!rep.ok && !override) {
        toast.error("Fix required columns before running", {
          description: "See the validation panel for details, or toggle \u201CRun anyway\u201D to bypass.",
        });
        return;
      }
      await yieldToBrowser();
      const ds = buildDataset(
        files.sla.filter((f) => f.wb).map((f) => f.wb!),
        files.breach.filter((f) => f.wb).map((f) => f.wb!),
        files.excl.filter((f) => f.wb).map((f) => f.wb!),
      );
      if (!Object.keys(ds.sla).length) {
        toast.error("No KPI sheets detected", { description: "Sheet names should match KSL-1, KSL-2a, …, KM-1, KM-2." });
        return;
      }
      await yieldToBrowser();
      setDataset(ds);
      setActiveMonth(null);
      toast.success("Analysis ready", { description: `${ds.months.length} months · ${ds.weeks.length} weeks · ${Object.keys(ds.sla).length} KPIs` });
    } catch (e) {
      toast.error("Analysis failed", { description: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };


  const reset = () => { setDataset(null); setFiles({ sla: [], breach: [], excl: [] }); setReport(null); setOverride(false); setExclMappings([]); };

  return (
    <div className="min-h-screen">
      <Toaster richColors position="top-right" />
      <Header onToggleTheme={toggleTheme} dark={dark} onReset={dataset ? reset : undefined} onExport={dataset ? () => exportDatasetWorkbook(dataset, activeMonth) : undefined} />

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
        Built client-side · Nothing leaves your browser · Drop new files anytime
      </footer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── HEADER */

function Header({ onToggleTheme, dark, onReset, onExport }: { onToggleTheme: () => void; dark: boolean; onReset?: () => void; onExport?: () => void }) {
  return (
    <header className="sticky top-0 z-40 glass border-b border-border/50">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[image:var(--gradient-primary)] ring-glow">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-display text-base font-bold">Pulse</span>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">KPI & Breaches Analyzer</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5">
              <Download className="h-3.5 w-3.5" /> Export report
            </Button>
          )}
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

/* ────────────────────────────────────────────────────────── UPLOAD HERO */

const SLOT_META: Record<Slot, { title: string; desc: string; required?: boolean; icon: typeof FileSpreadsheet; accent: string }> = {
  sla:    { title: "SLA Overall",            desc: "Workbook with one sheet per KPI (KSL-1…KM-2). Source of all KPI rates.", required: true, icon: FileSpreadsheet, accent: "from-[color:var(--chart-1)] to-[color:var(--primary-glow)]" },
  breach: { title: "KSL-5b Deep-dive (PCms)", desc: "Optional. Per-ticket KO/NOK reason categories — unlocks the KSL-5b Detail tab.", icon: Layers,         accent: "from-[color:var(--chart-3)] to-[color:var(--chart-4)]" },
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
          and a dedicated KSL-5b reason analysis — instantly.
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
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Crunching…</>
            : <><Activity className="mr-2 h-4 w-4" /> {report ? "Re-run analysis" : "Run analysis"} <ChevronRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" /></>}
        </Button>
        {hasErrors && (
          <p className="text-[11px] text-muted-foreground">
            Fix the validation errors above or enable “Run anyway” to bypass.
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
          Validation · {errors.length} error{errors.length === 1 ? "" : "s"} · {warns.length} warning{warns.length === 1 ? "" : "s"}
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
          {issue.sheet && <span className="text-muted-foreground"> · sheet “{issue.sheet}”</span>}
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
              <span className="text-muted-foreground"> · sheet “{m.sheet}”</span>
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
                          {r.candidate ? <code className="rounded bg-secondary/60 px-1.5 py-0.5">{r.candidate}</code> : <span className="italic">— not found —</span>}
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
              <span aria-hidden="true" className={cn("font-semibold", f.error ? "text-destructive" : "text-[color:var(--success)]")}>{f.error ? "!" : "✓"}</span>
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

/* ──────────────────────────────────────────────────────────── ANALYSIS */

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

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* Period chips */}
      <div
        className="mb-6 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by period"
      >
        <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Period</span>
        <Chip active={month === null} onClick={() => setMonth(null)} label="All months">All months</Chip>
        {ds.months.map((m) => (
          <Chip key={m} active={month === m} onClick={() => setMonth(m)} label={monthLabel(m)}>{monthLabel(m)}</Chip>
        ))}
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="glass h-12 w-full justify-start gap-1 rounded-2xl p-1.5">
          <TabTrigger value="overview" icon={BarChart3}>Overview</TabTrigger>
          <TabTrigger value="monthly" icon={LineChartIcon}>Monthly Trend</TabTrigger>
          <TabTrigger value="weekly"  icon={Activity}>Weekly Trend</TabTrigger>
          <TabTrigger value="queues"  icon={Layers}>Queue Analysis</TabTrigger>
          <TabTrigger value="excl"    icon={Filter}>Exclusion Impact</TabTrigger>
          <TabTrigger value="quality" icon={CheckCircle2}>KSL-4 &amp; KM-1</TabTrigger>
          {ds.pcms.length > 0 && <TabTrigger value="ksl5b" icon={Users}>KSL-5b Detail</TabTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <OverviewSection ds={ds} month={month} detected={detectedKpis} />
        </TabsContent>
        <TabsContent value="monthly" className="space-y-6">
          <MonthlySection ds={ds} detected={detectedKpis} />
        </TabsContent>
        <TabsContent value="weekly" className="space-y-6">
          <WeeklySection ds={ds} detected={detectedKpis} />
        </TabsContent>
        <TabsContent value="queues" className="space-y-6">
          <QueuesSection ds={ds} month={month} detected={detectedKpis} activeKpi={activeKpi} setActiveKpi={setActiveKpi} />
        </TabsContent>
        <TabsContent value="excl" className="space-y-6">
          <ExclusionSection ds={ds} month={month} detected={detectedKpis} />
        </TabsContent>
        <TabsContent value="quality" className="space-y-6">
          <QualityReopenSection ds={ds} month={month} detected={detectedKpis} />
        </TabsContent>
        {ds.pcms.length > 0 && (
          <TabsContent value="ksl5b" className="space-y-6">
            <Ksl5bDetail ds={ds} month={month} />
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

/* ─────────────────────────────────────────────────────── OVERVIEW */

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
        <StatBlock label="Breaches" value={totals.breaches.toLocaleString()} sub={totals.total ? ((totals.breaches / totals.total) * 100).toFixed(1) + "% of total" : "—"} icon={TrendingUp} accent="danger" />
        <StatBlock label="Excluded" value={totals.excluded.toLocaleString()} sub={totals.total ? ((totals.excluded / totals.total) * 100).toFixed(1) + "% removed" : "—"} icon={Filter} accent="warning" />
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
              {excludedCount.toLocaleString()} excluded ·
              {delta > 0
                ? <ArrowUp className="h-3 w-3 text-[color:var(--success)]" />
                : delta < 0
                ? <ArrowDown className="h-3 w-3 text-[color:var(--danger)]" />
                : null}
              <span>{Math.abs(delta).toFixed(1)}pp</span>
            </p>
          )}
        </div>
        <div className="h-10 w-24">
          {trend.length > 1 ? (
            <ResponsiveContainer>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id={`spark-${code}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={meta.color} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={meta.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area dataKey="rate" stroke={meta.color} strokeWidth={1.5} fill={`url(#spark-${code})`} type="monotone" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
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


function RagBadge({ rag, isKM }: { rag: "green" | "amber" | "red" | "none"; isKM: boolean }) {
  if (rag === "none") return <Badge variant="secondary" className="text-[10px]">no data</Badge>;
  const map = {
    green: "bg-[color:var(--success)]/15 text-[color:var(--success)] border-[color:var(--success)]/30",
    amber: "bg-[color:var(--warning)]/15 text-[color:var(--warning)] border-[color:var(--warning)]/30",
    red:   "bg-[color:var(--danger)]/15  text-[color:var(--danger)]  border-[color:var(--danger)]/30",
  }[rag];
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide", map)}>{ragLabel(rag, isKM)}</span>;
}

/* ─────────────────────────────────────────────────── MONTHLY */

const MonthlySection = React.memo(function MonthlySection({ ds, detected }: { ds: Dataset; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const data = withDeltas(monthlySummary(ds, code).map((p) => ({ ...p, label: monthLabel(p.label) })));
        const amber = amberBound(meta);
        return (
          <Panel key={code} title={code} subtitle={meta.what} badge={meta.targetLabel} exportName={`monthly_${code}`}>
            {data.length === 0
              ? <Empty message="No monthly data for this KPI." />
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data} margin={{ top: 18, right: 24, left: 0, bottom: 0 }}>
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
                </ResponsiveContainer>
              )}
          </Panel>
        );
      })}
    </div>
  );
});

/* ─────────────────────────────────────────────────── WEEKLY */

const WeeklySection = React.memo(function WeeklySection({ ds, detected }: { ds: Dataset; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const raw = weeklySummary(ds, code).map((p) => ({ ...p, label: weekLabel(p.label) }));
        const data = withDeltas(raw);
        const amber = amberBound(meta);
        const dotColor = (rag: string) =>
          rag === "green" ? "var(--success)"
          : rag === "amber" ? "var(--warning)"
          : rag === "red" ? "var(--danger)"
          : "var(--muted-foreground)";
        // Pad y-axis so labels never collide with the axis edge.
        const values = data.map((d) => d.rate).filter((v) => Number.isFinite(v));
        const minY = values.length ? Math.floor(Math.min(...values, meta.target) - 1.5) : "auto";
        const maxY = values.length ? Math.ceil(Math.max(...values, meta.target) + 1.5) : "auto";
        return (
          <Panel key={code} title={`${code} · last 6 weeks`} subtitle={meta.what} badge={meta.targetLabel} exportName={`weekly_${code}`}>
            {data.length === 0
              ? <Empty message="No weekly data for this KPI." />
              : (
                <>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data} margin={{ top: 26, right: 28, left: 4, bottom: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickFormatter={(v) => `${Math.round(v)}%`}
                        domain={[minY as number | "auto", maxY as number | "auto"]}
                      />
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
                      <Line
                        type="monotone"
                        dataKey="rate"
                        stroke={meta.color}
                        strokeWidth={2.5}
                        isAnimationActive={false}
                        dot={(props: any) => {
                          const { cx, cy, payload, index } = props;
                          return <circle key={index} cx={cx} cy={cy} r={5} fill={dotColor(payload.rag)} stroke={meta.color} strokeWidth={1.5} />;
                        }}
                        activeDot={{ r: 7 }}
                      >
                        <LabelList
                          dataKey="rate"
                          position="top"
                          offset={10}
                          formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "")}
                          style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }}
                        />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                  <WeeklyTable rows={data} isKM={meta.isKM} />
                </>
              )}
          </Panel>
        );
      })}
    </div>
  );
});

type WeeklyTableRow = { label: string; total: number; breaches: number; rate: number; rag: "green" | "amber" | "red" | "none"; delta: number | null; prev: number | null };
function WeeklyTable({ rows, isKM }: { rows: WeeklyTableRow[]; isKM: boolean }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border/50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 text-[11px]">Week</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Tickets</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Breaches</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Rate</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Δ vs prev</TableHead>
            <TableHead className="h-8 text-right text-[11px]">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const goodDelta = r.delta == null ? null : (isKM ? r.delta < 0 : r.delta > 0);
            const deltaColor = r.delta == null ? "var(--muted-foreground)"
              : goodDelta ? "var(--success)"
              : r.delta === 0 ? "var(--muted-foreground)" : "var(--danger)";
            const rateColor = r.rag === "green" ? "var(--success)" : r.rag === "amber" ? "var(--warning)" : r.rag === "red" ? "var(--danger)" : undefined;
            return (
              <TableRow key={r.label}>
                <TableCell className="py-1.5 text-xs font-medium">{r.label}</TableCell>
                <TableCell className="py-1.5 text-right text-xs tabular-nums">{r.total.toLocaleString()}</TableCell>
                <TableCell className="py-1.5 text-right text-xs tabular-nums">{r.breaches.toLocaleString()}</TableCell>
                <TableCell className="py-1.5 text-right text-xs font-semibold tabular-nums" style={{ color: rateColor }}>{r.rate.toFixed(1)}%</TableCell>
                <TableCell className="py-1.5 text-right text-xs tabular-nums" style={{ color: deltaColor }}>
                  {r.delta == null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta.toFixed(1)}pp`}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: rateColor ?? "var(--muted-foreground)" }} aria-label={r.rag} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─────────────────────────────────────────────────── QUEUES */

const QueuesSection = React.memo(function QueuesSection({
  ds, month, detected, activeKpi, setActiveKpi,
}: { ds: Dataset; month: string | null; detected: KpiCode[]; activeKpi: KpiCode; setActiveKpi: (k: KpiCode) => void }) {
  const safe = detected.includes(activeKpi) ? activeKpi : (detected[0] ?? "KSL-2c");
  const meta = KPI_META[safe];
  const queues = useMemo(
    () => queueBreakdown(ds, safe, month),
    [ds, safe, month],
  );
  const [activeQueue, setActiveQueue] = useState<string>("");
  const queue = queues.find((q) => q.queue === activeQueue)?.queue ?? queues[0]?.queue ?? "";

  const weekly = useMemo(() => {
    if (!queue) return [];
    return weeklyQueueSummary(ds, safe, queue, { lastN: 6 }).map((p) => ({ ...p, label: weekLabel(p.label) }));
  }, [ds, safe, queue]);
  const weeklyData = withDeltas(weekly);
  const amber = amberBound(meta);
  const dotColor = (rag: string) =>
    rag === "green" ? "var(--success)" : rag === "amber" ? "var(--warning)" : rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
  const values = weeklyData.map((d) => d.rate).filter((v) => Number.isFinite(v));
  const minY = values.length ? Math.floor(Math.min(...values, meta.target) - 1.5) : "auto";
  const maxY = values.length ? Math.ceil(Math.max(...values, meta.target) + 1.5) : "auto";

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">KPI</span>
        <Select value={safe} onValueChange={(v) => setActiveKpi(v as KpiCode)}>
          <SelectTrigger className="h-9 w-72 rounded-full glass"><SelectValue /></SelectTrigger>
          <SelectContent>
            {detected.map((c) => (
              <SelectItem key={c} value={c}>{c} — {KPI_META[c].what}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Queue</span>
        <Select value={queue} onValueChange={setActiveQueue}>
          <SelectTrigger className="h-9 w-64 rounded-full glass"><SelectValue placeholder="Select queue" /></SelectTrigger>
          <SelectContent>
            {queues.map((q) => (
              <SelectItem key={q.queue} value={q.queue}>{q.queue} · {q.total} tickets</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="ml-auto">{queues.length} queues</Badge>
      </div>

      <Panel title={`${safe} · ${queue || "—"} · weekly trend`} subtitle={meta.what} badge={meta.targetLabel} exportName={`queue_weekly_${safe}_${queue}`}>
        {weeklyData.length === 0
          ? <Empty message="No weekly data for this queue." />
          : (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={weeklyData} margin={{ top: 26, right: 28, left: 4, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} domain={[minY as number | "auto", maxY as number | "auto"]} />
                  <Tooltip content={<RichTip meta={meta} />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                  <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain"
                    label={{ value: `target ${meta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "insideTopRight" }} />
                  <ReferenceLine y={amber} stroke="var(--warning)" strokeDasharray="2 4" ifOverflow="extendDomain"
                    label={{ value: meta.isKM ? "watch ceiling" : "watch floor", fontSize: 10, fill: "var(--warning)", position: "insideBottomRight" }} />
                  <Line type="monotone" dataKey="rate" stroke={meta.color} strokeWidth={2.5} isAnimationActive={false}
                    dot={(props: any) => {
                      const { cx, cy, payload, index } = props;
                      return <circle key={index} cx={cx} cy={cy} r={5} fill={dotColor(payload.rag)} stroke={meta.color} strokeWidth={1.5} />;
                    }}
                    activeDot={{ r: 7 }}>
                    <LabelList dataKey="rate" position="top" offset={10}
                      formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "")}
                      style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
              <WeeklyTable rows={weeklyData} isKM={meta.isKM} />
            </>
          )}
      </Panel>

      <Panel title="All queues for this KPI" subtitle="Ranked by ticket volume — click a row to drill in">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead className="text-right">Breaches</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.map((q) => (
                <TableRow key={q.queue} className={cn("cursor-pointer", q.queue === queue && "bg-primary/5")} onClick={() => setActiveQueue(q.queue)}>
                  <TableCell className="font-medium">{q.queue}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.total.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.breaches.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums" style={{ color: q.rag === "green" ? "var(--success)" : q.rag === "amber" ? "var(--warning)" : q.rag === "red" ? "var(--danger)" : undefined }}>
                    {q.display}
                  </TableCell>
                  <TableCell className="text-right"><RagBadge rag={q.rag} isKM={meta.isKM} /></TableCell>
                </TableRow>
              ))}
              {queues.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No queues for this filter.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  );
});

/* ─────────────────────────────────────────────────── EXCLUSION IMPACT */

function ExclusionSection({ ds, month, detected }: { ds: Dataset; month: string | null; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const e = exclusionImpact(ds, code, month);
        if (e.excluded === 0) {
          return (
            <Panel key={code} title={code} subtitle={meta.what} badge="no exclusions">
              <p className="py-6 text-center text-xs text-muted-foreground">
                {e.rawTotal.toLocaleString()} tickets · {e.rawBreaches.toLocaleString()} breaches · no rows excluded.
              </p>
            </Panel>
          );
        }
        const delta = e.adj.value - e.raw.value;
        const positive = delta > 0;
        return (
          <Panel key={code} title={code} subtitle={meta.what} badge={`${e.excluded} excluded`}>
            <div className="flex items-end gap-3">
              <p className="font-display text-3xl font-bold tabular-nums" style={{ color: e.adj.rag === "green" ? "var(--success)" : e.adj.rag === "amber" ? "var(--warning)" : e.adj.rag === "red" ? "var(--danger)" : undefined }}>
                {e.adj.display}
              </p>
              <span className="pb-1 text-xs text-muted-foreground line-through">{e.raw.display}</span>
              <span className={cn(
                "ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
                positive
                  ? "border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]"
                  : "border-[color:var(--danger)]/30 bg-[color:var(--danger)]/10 text-[color:var(--danger)]",
              )}>
                {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {Math.abs(delta).toFixed(1)}pp
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <Mini label="Raw total" value={e.rawTotal.toLocaleString()} />
              <Mini label="Excluded" value={e.excluded.toLocaleString()} />
              <Mini label="Adj. breaches" value={e.adjBreaches.toLocaleString()} />
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────── Shared panel + helpers */

function Panel({ title, subtitle, badge, exportName, children }: { title: string; subtitle?: string; badge?: string; exportName?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <section ref={ref} className="glass overflow-hidden rounded-2xl ring-soft">
      <header className="flex items-center gap-3 border-b border-border/60 px-5 py-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold leading-tight">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {badge && <Badge data-export-nowrap variant="secondary" className="ml-auto whitespace-nowrap text-[10px]">{badge}</Badge>}
        {exportName && <div className={cn(badge ? "" : "ml-auto")}><ExportMenu targetRef={ref} name={exportName} /></div>}
      </header>
      <div className="p-4"><DeferredMount>{children}</DeferredMount></div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="py-10 text-center text-xs text-muted-foreground">{message}</p>;
}


function RichTip({ active, payload, label, meta }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const rate: number = Number(row.rate ?? 0);
  const prev: number | null = row.prev != null ? Number(row.prev) : null;
  const delta = prev == null ? null : rate - prev;
  const gap = rate - meta.target;
  const ragColor =
    row.rag === "green" ? "var(--success)"
    : row.rag === "amber" ? "var(--warning)"
    : row.rag === "red" ? "var(--danger)"
    : "var(--muted-foreground)";
  const ragText = ragLabel(row.rag ?? "none", meta.isKM);
  const gapGood = meta.isKM ? gap <= 0 : gap >= 0;
  return (
    <div
      role="tooltip"
      className="glass min-w-[180px] rounded-xl border border-border/60 px-3 py-2 text-xs shadow-md"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span
          className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wide"
          style={{ color: ragColor, borderColor: ragColor, backgroundColor: `color-mix(in oklab, ${ragColor} 15%, transparent)` }}
        >
          {ragText}
        </span>
      </div>
      <p className="tabular-nums">
        <span className="text-muted-foreground">Rate</span>{" "}
        <span className="font-semibold" style={{ color: ragColor }}>{rate.toFixed(1)}%</span>
      </p>
      <p className="tabular-nums text-muted-foreground">
        Target {meta.targetLabel} ·{" "}
        <span style={{ color: gapGood ? "var(--success)" : "var(--danger)" }}>
          {gap >= 0 ? "+" : ""}{gap.toFixed(1)}pp
        </span>
      </p>
      {delta != null && (
        <p className="tabular-nums text-muted-foreground">
          Δ vs prior{" "}
          <span style={{ color: (meta.isKM ? delta < 0 : delta > 0) ? "var(--success)" : delta === 0 ? "var(--muted-foreground)" : "var(--danger)" }}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {Math.abs(delta).toFixed(1)}pp
          </span>
        </p>
      )}
      {row.total != null && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {Number(row.total).toLocaleString()} tickets · {Number(row.breaches ?? 0).toLocaleString()} breaches
        </p>
      )}
    </div>
  );
}

// Amber threshold above/below which RAG flips from green→amber, used as a visual zone band.
function amberBound(meta: { target: number; isKM: boolean }) {
  return meta.isKM ? meta.target * 1.5 : meta.target - 5;
}

// Inject prev/delta on each datum so the tooltip can show week-over-week change.
function withDeltas<T extends { rate: number }>(rows: T[]): (T & { prev: number | null; delta: number | null })[] {
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1].rate : null;
    return { ...r, prev, delta: prev == null ? null : r.rate - prev };
  });
}

/* ─────────────────────────────────────────────────── KSL-4 & KM-1 FOCUS */

function ExportableTile({ ds, code, month }: { ds: Dataset; code: KpiCode; month: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="relative">
      <div className="absolute right-2 top-2 z-10">
        <ExportMenu targetRef={ref} name={`quality_tile_${code}`} />
      </div>
      <KpiTile ds={ds} code={code} month={month} />
    </div>
  );
}


const QualityReopenSection = React.memo(function QualityReopenSection({ ds, month, detected }: { ds: Dataset; month: string | null; detected: KpiCode[] }) {
  const codes = (["KSL-4", "KM-1"] as KpiCode[]).filter((c) => detected.includes(c));
  if (codes.length === 0) {
    return <Empty message="Neither KSL-4 nor KM-1 sheets were detected in the uploaded SLA workbook." />;
  }
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {codes.map((c) => <ExportableTile key={c} ds={ds} code={c} month={month} />)}
      </div>


      {codes.map((code) => {
        const meta = KPI_META[code];
        const monthly = withDeltas(monthlySummary(ds, code).map((p) => ({ ...p, label: monthLabel(p.label) })));
        const weekly = withDeltas(weeklySummary(ds, code, { lastN: 6 }).map((p) => ({ ...p, label: weekLabel(p.label) })));
        const queues = queueBreakdown(ds, code, month);
        const amber = amberBound(meta);
        const dotColor = (rag: string) =>
          rag === "green" ? "var(--success)" : rag === "amber" ? "var(--warning)" : rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
        const wValues = weekly.map((d) => d.rate).filter((v) => Number.isFinite(v));
        const minY = wValues.length ? Math.floor(Math.min(...wValues, meta.target) - 1.5) : "auto";
        const maxY = wValues.length ? Math.ceil(Math.max(...wValues, meta.target) + 1.5) : "auto";
        return (
          <div key={code} className="space-y-5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
              <h2 className="font-display text-lg font-bold">{code} · {meta.what}</h2>
              <Badge variant="secondary" className="text-[10px]">target {meta.targetLabel}</Badge>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Panel title={`${code} · monthly trend`} subtitle={meta.what} badge={meta.targetLabel} exportName={`quality_monthly_${code}`}>
                {monthly.length === 0 ? <Empty message="No monthly data." /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={monthly} margin={{ top: 22, right: 24, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                      <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
                      <Tooltip content={<RichTip meta={meta} />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                      <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain"
                        label={{ value: `target ${meta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "insideTopRight" }} />
                      <ReferenceLine y={amber} stroke="var(--warning)" strokeDasharray="2 4" ifOverflow="extendDomain"
                        label={{ value: meta.isKM ? "watch ceiling" : "watch floor", fontSize: 10, fill: "var(--warning)", position: "insideBottomRight" }} />
                      <Line type="monotone" dataKey="rate" stroke={meta.color} strokeWidth={2.5} isAnimationActive={false}
                        dot={(props: any) => {
                          const { cx, cy, payload, index } = props;
                          return <circle key={index} cx={cx} cy={cy} r={4} fill={dotColor(payload.rag)} stroke={meta.color} strokeWidth={1.5} />;
                        }}
                        activeDot={{ r: 6 }}>
                        <LabelList dataKey="rate" position="top" offset={10}
                          formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "")}
                          style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
                      </Line>
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Panel>

              <Panel title={`${code} · last 6 weeks`} subtitle={meta.what} badge={meta.targetLabel} exportName={`quality_weekly_${code}`}>
                {weekly.length === 0 ? <Empty message="No weekly data." /> : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart data={weekly} margin={{ top: 26, right: 28, left: 4, bottom: 6 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                        <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} domain={[minY as number | "auto", maxY as number | "auto"]} />
                        <Tooltip content={<RichTip meta={meta} />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                        <ReferenceLine y={meta.target} stroke="var(--success)" strokeDasharray="5 4" ifOverflow="extendDomain"
                          label={{ value: `target ${meta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "insideTopRight" }} />
                        <ReferenceLine y={amber} stroke="var(--warning)" strokeDasharray="2 4" ifOverflow="extendDomain"
                          label={{ value: meta.isKM ? "watch ceiling" : "watch floor", fontSize: 10, fill: "var(--warning)", position: "insideBottomRight" }} />
                        <Line type="monotone" dataKey="rate" stroke={meta.color} strokeWidth={2.5} isAnimationActive={false}
                          dot={(props: any) => {
                            const { cx, cy, payload, index } = props;
                            return <circle key={index} cx={cx} cy={cy} r={5} fill={dotColor(payload.rag)} stroke={meta.color} strokeWidth={1.5} />;
                          }}
                          activeDot={{ r: 7 }}>
                          <LabelList dataKey="rate" position="top" offset={10}
                            formatter={(v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "")}
                            style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
                        </Line>
                      </LineChart>
                    </ResponsiveContainer>
                    <WeeklyTable rows={weekly} isKM={meta.isKM} />
                  </>
                )}
              </Panel>
            </div>

            <Panel title={`${code} · queue breakdown`} subtitle="Ranked by ticket volume in the active period" exportName={`quality_queues_${code}`}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Queue</TableHead>
                      <TableHead className="text-right">Tickets</TableHead>
                      <TableHead className="text-right">Breaches</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queues.map((q) => (
                      <TableRow key={q.queue}>
                        <TableCell className="font-medium">{q.queue}</TableCell>
                        <TableCell className="text-right tabular-nums">{q.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{q.breaches.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums" style={{ color: q.rag === "green" ? "var(--success)" : q.rag === "amber" ? "var(--warning)" : q.rag === "red" ? "var(--danger)" : undefined }}>
                          {q.display}
                        </TableCell>
                        <TableCell className="text-right"><RagBadge rag={q.rag} isKM={meta.isKM} /></TableCell>
                      </TableRow>
                    ))}
                    {queues.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No queues for this filter.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          </div>
        );
      })}
    </>
  );
});

/* ─────────────────────────────────────────────────── KSL-5b DETAIL (PCms) */


const Ksl5bDetail = React.memo(function Ksl5bDetail({ ds, month }: { ds: Dataset; month: string | null }) {
  // Filter PCms rows by selected month
  const scopedByMonth = useMemo(() => {
    if (!month) return ds.pcms;
    return ds.pcms.filter((r) => r.monthKey === month);
  }, [ds.pcms, month]);

  // Week list available in current month scope
  const availableWeeks = useMemo(() => {
    const s = new Set<string>();
    scopedByMonth.forEach((r) => { if (r.weekKey) s.add(r.weekKey); });
    return [...s].sort();
  }, [scopedByMonth]);

  const [activeWeek, setActiveWeek] = useState<string>("all");
  const scoped = useMemo(() => {
    if (activeWeek === "all") return scopedByMonth;
    return scopedByMonth.filter((r) => r.weekKey === activeWeek);
  }, [scopedByMonth, activeWeek]);

  const [activeCat, setActiveCat] = useState<number | null>(null);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return scoped.filter((r) =>
      (activeCat == null || r.category === activeCat)
      && (activeAgent == null || r.agent === activeAgent)
      && (!search.trim() || r.ticket.toLowerCase().includes(search.toLowerCase()) || r.reason.toLowerCase().includes(search.toLowerCase())),
    );
  }, [scoped, activeCat, activeAgent, search]);

  // Reason mix — sorted horizontal bar of category totals, split KO/NOK
  const reasonMix = useMemo(() => {
    const map = new Map<number, { id: number; label: string; color: string; ko: number; nok: number; total: number }>();
    PCMS_CATEGORIES.forEach((c) => map.set(c.id, { id: c.id, label: `${c.id}. ${c.label}`, color: c.color, ko: 0, nok: 0, total: 0 }));
    filtered.forEach((r) => {
      const m = map.get(r.category);
      if (!m) return;
      if (r.status === "KO") m.ko += 1;
      else if (r.status === "NOK") m.nok += 1;
      m.total += 1;
    });
    return [...map.values()].filter((m) => m.total > 0).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const agents = useMemo(() => pcmsTopAgents(filtered, 10), [filtered]);
  const weekly = useMemo(() => pcmsWeeklyCounts(scopedByMonth), [scopedByMonth]);
  const ksl5bWeekly = useMemo(
    () => weeklySummary(ds, "KSL-5b", { lastN: 12 }).map((p) => ({ ...p, label: weekLabel(p.label), weekKey: p.label })),
    [ds],
  );
  const overlay = useMemo(() => {
    const koMap = new Map(weekly.map((w) => [w.weekKey, w.count]));
    return ksl5bWeekly.map((w) => ({ ...w, koCount: koMap.get(w.weekKey) ?? 0 }));
  }, [ksl5bWeekly, weekly]);

  const ksl5bMeta = KPI_META["KSL-5b"];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Week</span>
        <Select value={activeWeek} onValueChange={setActiveWeek}>
          <SelectTrigger className="h-8 w-44 rounded-full glass"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All weeks{month ? " in month" : ""}</SelectItem>
            {availableWeeks.map((w) => (
              <SelectItem key={w} value={w}>{weekLabel(w)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-[10px]">{filtered.length.toLocaleString()} PCms rows</Badge>
        {activeCat != null && (
          <button onClick={() => setActiveCat(null)} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            cat {activeCat} <X className="h-3 w-3" />
          </button>
        )}
        {activeAgent && (
          <button onClick={() => setActiveAgent(null)} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            {activeAgent} <X className="h-3 w-3" />
          </button>
        )}
        {(activeCat != null || activeAgent || search || activeWeek !== "all") && (
          <button onClick={() => { setActiveCat(null); setActiveAgent(null); setSearch(""); setActiveWeek("all"); }} className="text-[11px] text-muted-foreground underline-offset-2 hover:underline">Clear filters</button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Reason mix" subtitle="KO vs NOK count per reason category — sorted by volume" exportName="pcms_reasons">
          {reasonMix.length === 0 ? <Empty message="No PCms rows for this filter." /> : (
            <ResponsiveContainer width="100%" height={Math.max(280, reasonMix.length * 34)}>
              <BarChart data={reasonMix} layout="vertical" margin={{ top: 6, right: 36, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={200} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ko"  name="KO"  stackId="s" fill="var(--danger)" isAnimationActive={false} onClick={(d: any) => setActiveCat((c) => c === d.id ? null : d.id)} />
                <Bar dataKey="nok" name="NOK" stackId="s" fill="var(--warning)" isAnimationActive={false} onClick={(d: any) => setActiveCat((c) => c === d.id ? null : d.id)}>
                  <LabelList dataKey="total" position="right" style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title={`Top agents by KO/NOK${activeWeek === "all" ? "" : " · " + weekLabel(activeWeek)}`} subtitle="Click a bar to filter the drill table" exportName="pcms_agents">
          {agents.length === 0 ? <Empty message="No agent data for this filter." /> : (
            <ResponsiveContainer width="100%" height={Math.max(260, agents.length * 32)}>
              <BarChart data={agents} layout="vertical" margin={{ top: 4, right: 24, left: 12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                <YAxis type="category" dataKey="agent" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={120} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.12 }} content={<AgentTip />} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill={ksl5bMeta.color} onClick={(d: any) => setActiveAgent((a) => a === d.agent ? null : d.agent)}>
                  <LabelList dataKey="count" position="right" style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>


      <Panel title="KSL-5b weekly trend · PCms overlay" subtitle="Bars = PCms KO/NOK count per week (right axis). Line = KSL-5b conformity %." exportName="pcms_ksl5b_overlay">
        {overlay.length === 0 ? <Empty message="No KSL-5b weekly data." /> : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={overlay} margin={{ top: 20, right: 28, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <Tooltip cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
              <ReferenceLine yAxisId="left" y={ksl5bMeta.target} stroke="var(--success)" strokeDasharray="5 4" label={{ value: `target ${ksl5bMeta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "insideTopRight" }} />
              <Bar yAxisId="right" dataKey="koCount" name="PCms KO/NOK" fill="var(--warning)" opacity={0.55} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="koCount" position="top" style={{ fontSize: 10, fill: "var(--warning)" }} />
              </Bar>
              <Line yAxisId="left" type="monotone" dataKey="rate" name="KSL-5b %" stroke={ksl5bMeta.color} strokeWidth={2.5} dot={{ r: 4, fill: ksl5bMeta.color }} isAnimationActive={false}>
                <LabelList dataKey="rate" position="top" offset={10} formatter={(v: number) => Number.isFinite(v) ? `${v.toFixed(1)}%` : ""} style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }} />
              </Line>
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel title="Reason-category drill" subtitle={`${filtered.length.toLocaleString()} rows · filterable + searchable`}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket or reason…"
            className="h-8 w-60 rounded-lg border border-border/60 bg-background/60 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
            {PCMS_CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCat((cur) => cur === c.id ? null : c.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
                  activeCat === c.id ? "border-transparent text-white" : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
                )}
                style={activeCat === c.id ? { background: c.color } : undefined}
              >
                {c.id}. {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-96 overflow-auto rounded-xl border border-border/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-[11px]">Ticket</TableHead>
                <TableHead className="h-8 text-[11px]">Week</TableHead>
                <TableHead className="h-8 text-[11px]">Month</TableHead>
                <TableHead className="h-8 text-[11px]">Category</TableHead>
                <TableHead className="h-8 text-[11px]">Reason</TableHead>
                <TableHead className="h-8 text-[11px]">Agent</TableHead>
                <TableHead className="h-8 text-[11px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 500).map((r, i) => (
                <TableRow key={`${r.ticket}-${i}`}>
                  <TableCell className="py-1 text-xs font-mono">{r.ticket}</TableCell>
                  <TableCell className="py-1 text-xs">W{r.weekNum ?? "—"}</TableCell>
                  <TableCell className="py-1 text-xs">{r.monthName}</TableCell>
                  <TableCell className="py-1 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full" style={{ background: PCMS_CATEGORIES.find((c) => c.id === r.category)?.color ?? "var(--muted-foreground)" }} />
                      {r.category}. {r.categoryLabel}
                    </span>
                  </TableCell>
                  <TableCell className="py-1 text-xs">{r.reason}</TableCell>
                  <TableCell className="py-1 text-xs">{r.agent}</TableCell>
                  <TableCell className="py-1 text-xs">
                    <Badge variant="secondary" className="text-[10px]">{r.status || "—"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-xs text-muted-foreground">No PCms rows match the current filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {filtered.length > 500 && (
          <p className="mt-2 text-center text-[10px] text-muted-foreground">Showing first 500 of {filtered.length.toLocaleString()} rows · narrow with filters.</p>
        )}
      </Panel>
    </>
  );
});


function AgentTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ReturnType<typeof pcmsTopAgents>[number];
  const top = Object.entries(row.byCat).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4);
  return (
    <div className="glass min-w-[200px] rounded-xl border border-border/60 px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{row.agent}</p>
      <p className="tabular-nums text-muted-foreground">
        {row.count.toLocaleString()} total · {row.ko.toLocaleString()} KO · {row.nok.toLocaleString()} NOK
      </p>
      <div className="mt-1 space-y-0.5 border-t border-border/60 pt-1">
        {top.map(([cat, count]) => {
          const c = PCMS_CATEGORIES.find((x) => x.id === Number(cat));
          return (
            <p key={cat} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: c?.color ?? "var(--muted-foreground)" }} />
              <span className="flex-1 truncate text-muted-foreground">{c?.label ?? `Cat ${cat}`}</span>
              <span className="font-semibold tabular-nums">{count}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}
