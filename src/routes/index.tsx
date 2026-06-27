import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { PCMS_CATEGORIES, pcmsTopAgents, pcmsWeeklyCounts } from "@/lib/analyzer/parsePcms";
import { buildReport, buildExclMappings, type ValidationReport, type ValidationIssue, type SheetMapping } from "@/lib/analyzer/validate";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
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
    try {
      await new Promise((r) => setTimeout(r, 50));
      const rep = buildReport(
        files.sla.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb })),
        files.breach.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb })),
        files.excl.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb })),
      );
      setReport(rep);
      setExclMappings(buildExclMappings(files.excl.filter((f) => f.wb).map((f) => ({ name: f.name, wb: f.wb }))));
      if (!rep.ok && !override) {
        toast.error("Fix required columns before running", {
          description: "See the validation panel for details, or toggle \"Run anyway\" to bypass.",
        });
        return;
      }
      const ds = buildDataset(
        files.sla.filter((f) => f.wb).map((f) => f.wb!),
        files.breach.filter((f) => f.wb).map((f) => f.wb!),
        files.excl.filter((f) => f.wb).map((f) => f.wb!),
      );
      if (!Object.keys(ds.sla).length) {
        toast.error("No KPI sheets detected", { description: "Sheet names should match KSL-1, KSL-2a, …, KM-1, KM-2." });
        return;
      }
      setDataset(ds);
      setActiveMonth(null);
      toast.success("Analysis ready", { description: `${ds.months.length} months · ${ds.weeks.length} weeks · ${Object.keys(ds.sla).length} KPIs` });
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

function UploadHero({
  files, onAdd, onRemove, onRun, canRun, busy, report, exclMappings, override, setOverride,
}: {
  files: Record<Slot, LoadedFile[]>; onAdd: (slot: Slot, list: FileList | File[]) => void; onRemove: (slot: Slot, idx: number) => void;
  onRun: () => void; canRun: boolean; busy: boolean; report: ValidationReport | null;
  exclMappings: SheetMapping[]; override: boolean; setOverride: (v: boolean) => void;
}) {
  const dragSlot = useRef<Slot | null>(null);
  const [dragging, setDragging] = useState(false);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onDrop = (slot: Slot) => (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); onAdd(slot, e.dataTransfer.files);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold text-foreground">Pulse</h1>
        <p className="mt-2 text-lg text-muted-foreground">KPI & Breaches Analyzer</p>
      </div>

      {report && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-500" />
            <div className="flex-1">
              <h3 className="font-semibold text-yellow-900 dark:text-yellow-100">Validation Issues</h3>
              <ul className="mt-2 space-y-1 text-sm text-yellow-800 dark:text-yellow-200">
                {report.issues.map((issue, idx) => (
                  <li key={idx}>
                    <strong>{issue.file}:</strong> {issue.message}
                  </li>
                ))}
              </ul>
              <label className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium">Run anyway (may produce incorrect results)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {(["sla", "breach", "excl"] as const).map((slot) => (
          <div key={slot}>
            <div
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDrop={onDrop(slot)}
              className={cn(
                "relative rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              )}
            >
              <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
              <div className="mt-2">
                <p className="text-sm font-semibold text-foreground capitalize">{slot === "sla" ? "Weekly SLA" : slot === "breach" ? "Enriched Breaches" : "Exclusions"}</p>
                <p className="text-xs text-muted-foreground">Drag here or</p>
              </div>
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files && onAdd(slot, e.target.files)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
              <Button size="sm" variant="outline" className="mt-2">
                Browse
              </Button>
            </div>
            {files[slot].length > 0 && (
              <div className="mt-3 space-y-1">
                {files[slot].map((f, idx) => (
                  <div key={idx} className="flex items-center justify-between rounded bg-muted p-2 text-xs">
                    <span className="truncate text-muted-foreground">{f.name}</span>
                    {f.error ? (
                      <Badge variant="destructive" className="ml-2 flex-shrink-0">Error</Badge>
                    ) : f.wb ? (
                      <Badge variant="outline" className="ml-2 flex-shrink-0">✓</Badge>
                    ) : (
                      <Loader2 className="ml-2 h-3 w-3 flex-shrink-0 animate-spin" />
                    )}
                    <button
                      onClick={() => onRemove(slot, idx)}
                      className="ml-2 flex-shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        onClick={onRun}
        disabled={!canRun || busy}
        className="mx-auto mt-8 gap-2"
        size="lg"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing...
          </>
        ) : (
          <>
            <Activity className="h-4 w-4" /> Analyze
          </>
        )}
      </Button>
    </div>
  );
}

/* ────────────────────────────────────────────────── ANALYSIS VIEW */

function Analysis({
  ds, month, setMonth, activeKpi, setActiveKpi,
}: {
  ds: Dataset; month: string | null; setMonth: (m: string | null) => void;
  activeKpi: KpiCode; setActiveKpi: (k: KpiCode) => void;
}) {
  const exportRef = useRef<HTMLDivElement>(null);

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
      {/* Controls */}
      <div className="sticky top-16 z-20 flex flex-col gap-4 rounded-lg bg-background p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap gap-2">
          <div className="flex-1 min-w-56">
            <label className="text-xs font-medium text-muted-foreground">Month</label>
            <Select value={month ?? "__all"} onValueChange={(v) => setMonth(v === "__all" ? null : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Overall" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Overall</SelectItem>
                {ds.months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-56">
            <label className="text-xs font-medium text-muted-foreground">KPI</label>
            <Select value={activeKpi} onValueChange={(v) => setActiveKpi(v as KpiCode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KPI_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ExportMenu targetRef={exportRef} name={`pulse-${activeKpi}${month ? `-${month}` : ""}`} />
      </div>

      <div ref={exportRef}>
        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="trend">6-Week Trend</TabsTrigger>
            <TabsTrigger value="drill">Per Queue</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <KpiGrid ds={ds} activeKpi={activeKpi} setActiveKpi={setActiveKpi} month={month} />
            <KpiDetails ds={ds} activeKpi={activeKpi} month={month} />
          </TabsContent>

          <TabsContent value="trend" className="space-y-6">
            <TrendChart ds={ds} activeKpi={activeKpi} />
          </TabsContent>

          <TabsContent value="drill" className="space-y-6">
            <DrillDown ds={ds} month={month} activeKpi={activeKpi} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

/* ────────────────────────────────────────────────────── KPI GRID */

function KpiGrid({
  ds, activeKpi, setActiveKpi, month,
}: {
  ds: Dataset; activeKpi: KpiCode; setActiveKpi: (k: KpiCode) => void; month: string | null;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
      {KPI_ORDER.map((k) => {
        const meta = KPI_META[k];
        const s = overallByKpi(ds, k, month);
        const ok = s.rag === "green";
        return (
          <button
            key={k}
            type="button"
            onClick={() => setActiveKpi(k)}
            className={cn(
              "rounded-lg p-3 text-center transition-colors",
              k === activeKpi ? "bg-primary/10 ring-1 ring-primary" : "bg-muted hover:bg-muted/80 cursor-pointer",
            )}
          >
            <div className="text-sm font-semibold text-foreground">{k}</div>
            <div className={cn("mt-2 text-2xl font-bold", ok ? "text-green-600" : s.rag === "amber" ? "text-amber-600" : "text-red-600")}>
              {s.display}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {s.total} tickets · {s.breaches} breaches
            </div>
            <Badge variant={ok ? "outline" : "destructive"} className="mt-2 w-full justify-center">
              {ragLabel(s.rag, meta.isKM)}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────── KPI DETAILS */

function KpiDetails({
  ds, activeKpi, month,
}: {
  ds: Dataset; activeKpi: KpiCode; month: string | null;
}) {
  const meta = KPI_META[activeKpi];
  const after = overallByKpi(ds, activeKpi, month);
  const before = rawOverallByKpi(ds, activeKpi, month);
  const impact = exclusionImpact(ds, activeKpi, month);

  if (!after.total && !before.total) return <Empty message="No data for selected KPI" />;
  const ok = after.rag === "green";

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="mb-1 text-lg font-semibold text-foreground">{activeKpi} — {meta.what}</h3>
      <p className="mb-4 text-xs text-muted-foreground">Target {meta.targetLabel}</p>
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <div className="text-sm text-muted-foreground">Before exclusion</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{before.display}</div>
          <div className="mt-1 text-xs text-muted-foreground">{before.total} tickets · {before.breaches} breaches</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">After exclusion</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{after.display}</div>
          <div className="mt-1 text-xs text-muted-foreground">{after.total} tickets · {after.breaches} breaches</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Excluded</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{impact.excluded}</div>
          <div className="mt-1 text-xs text-muted-foreground">tickets removed</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Status</div>
          <div className="mt-1">
            <Badge variant={ok ? "outline" : "destructive"}>
              {ragLabel(after.rag, meta.isKM)}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────── TREND CHART */

function TrendChart({ ds, activeKpi }: { ds: Dataset; activeKpi: KpiCode }) {
  const meta = KPI_META[activeKpi];
  const weekly = weeklySummary(ds, activeKpi, { lastN: 6 });
  const chartData = weekly.map((p) => ({ week: weekLabel(p.label), pct: p.rate }));

  if (!chartData.length) return <Empty message="No weekly data" />;

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="mb-4 text-lg font-semibold text-foreground">{activeKpi} — 6-Week Trend</h3>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week" />
          <YAxis domain={meta.isRating ? [0, 5] : [0, 100]} />
          <Tooltip formatter={(v) => (meta.isRating ? (v as number).toFixed(2) : `${(v as number).toFixed(1)}%`)} />
          <ReferenceLine y={meta.target} stroke="#888" strokeDasharray="3 3" label={`Target: ${meta.targetLabel}`} />
          <Line type="monotone" dataKey="pct" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }}>
            <LabelList dataKey="pct" position="top" formatter={(v: number) => (meta.isRating ? v.toFixed(2) : `${v.toFixed(1)}%`)} />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ────────────────────────────────────────────── DRILL DOWN */

function DrillDown({
  ds, month, activeKpi,
}: {
  ds: Dataset; month: string | null; activeKpi: KpiCode;
}) {
  const breakdown = queueBreakdown(ds, activeKpi, month);

  if (!breakdown.length) return <Empty message="No queue data available" />;

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="mb-4 text-lg font-semibold text-foreground">{activeKpi} by Queue</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead className="text-right">Tickets</TableHead>
              <TableHead className="text-right">Breaches</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {breakdown.map((row) => (
              <TableRow key={row.queue}>
                <TableCell className="font-medium">{row.queue}</TableCell>
                <TableCell className="text-right">{row.total}</TableCell>
                <TableCell className="text-right text-red-600">{row.breaches}</TableCell>
                <TableCell className="text-right font-semibold">{row.display}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="py-10 text-center text-xs text-muted-foreground">{message}</p>;
}

