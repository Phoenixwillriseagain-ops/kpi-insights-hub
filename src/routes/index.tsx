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
  const monthData = month ? ds.months[month] : undefined;
  const summary = month ? monthlySummary(monthData!) : rawOverallByKpi(ds.sla);
  const weeklies = month ? monthData!.weeks : ds.weeks.slice(-6);

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
      {/* Controls */}
      <div className="sticky top-16 z-20 flex flex-col gap-4 rounded-lg bg-background p-4 shadow-sm md:flex-row md:items-center">
        <div className="flex flex-1 flex-wrap gap-2">
          <div className="flex-1 min-w-56">
            <label className="text-xs font-medium text-muted-foreground">Month</label>
            <Select value={month ?? ""} onValueChange={(v) => setMonth(v || null)}>
              <SelectTrigger>
                <SelectValue placeholder="Overall" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Overall</SelectItem>
                {ds.months_list.map((m) => (
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

        {month && (
          <ExportMenu ds={ds} month={month} />
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trend">6-Week Trend</TabsTrigger>
          <TabsTrigger value="drill">Per Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <KpiGrid ds={ds} activeKpi={activeKpi} summary={summary} />
          <KpiDetails ds={ds} activeKpi={activeKpi} summary={summary} month={month} />
        </TabsContent>

        <TabsContent value="trend" className="space-y-6">
          <TrendChart weeklies={weeklies} activeKpi={activeKpi} />
        </TabsContent>

        <TabsContent value="drill" className="space-y-6">
          <DrillDown ds={ds} month={month} activeKpi={activeKpi} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

/* ────────────────────────────────────────────────────── KPI GRID */

function KpiGrid({
  ds, activeKpi, summary,
}: {
  ds: Dataset; activeKpi: KpiCode; summary: Record<KpiCode, { ok: boolean; tickets: number; breaches: number; pct: number }>;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
      {KPI_ORDER.map((k) => {
        const s = summary[k];
        const meta = KPI_META[k];
        return (
          <div
            key={k}
            className={cn(
              "rounded-lg p-3 text-center transition-colors",
              k === activeKpi ? "bg-primary/10 ring-1 ring-primary" : "bg-muted hover:bg-muted/80 cursor-pointer",
            )}
          >
            <div className="text-sm font-semibold text-foreground">{k}</div>
            <div className={cn("mt-2 text-2xl font-bold", s.ok ? "text-green-600" : "text-red-600")}>
              {s.pct.toFixed(1)}%
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {s.tickets} tickets · {s.breaches} breaches
            </div>
            <Badge variant={s.ok ? "outline" : "destructive"} className="mt-2 w-full justify-center">
              {ragLabel(s.pct, meta.target)}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────── KPI DETAILS */

function KpiDetails({
  ds, activeKpi, summary, month,
}: {
  ds: Dataset; activeKpi: KpiCode; summary: Record<KpiCode, { ok: boolean; tickets: number; breaches: number; pct: number }>;
  month: string | null;
}) {
  const meta = KPI_META[activeKpi];
  const s = summary[activeKpi];
  const kpiData = month ? ds.months[month]?.kpis?.[activeKpi] : ds.sla[activeKpi];

  if (!kpiData) return <Empty message="No data for selected KPI" />;

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="mb-4 text-lg font-semibold text-foreground">{activeKpi} Details</h3>
      <div className="grid gap-4 md:grid-cols-4">
        <div>
          <div className="text-sm text-muted-foreground">Compliance</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{s.pct.toFixed(2)}%</div>
          <div className="mt-1 text-xs text-muted-foreground">Target: {meta.target}%</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Tickets</div>
          <div className="mt-1 text-2xl font-bold text-foreground">{s.tickets}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Breaches</div>
          <div className="mt-1 text-2xl font-bold text-red-600">{s.breaches}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Status</div>
          <div className="mt-1">
            <Badge variant={s.ok ? "outline" : "destructive"}>
              {ragLabel(s.pct, meta.target)}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────── TREND CHART */

function TrendChart({
  weeklies, activeKpi,
}: {
  weeklies: Dataset["weeks"]; activeKpi: KpiCode;
}) {
  const meta = KPI_META[activeKpi];
  const chartData = weeklies.map((w) => ({
    week: weekLabel(w.isoWeek),
    pct: w.kpis?.[activeKpi]?.pct ?? 0,
  }));

  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="mb-4 text-lg font-semibold text-foreground">{activeKpi} - 6-Week Trend</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="week" />
          <YAxis domain={[0, 100]} />
          <Tooltip formatter={(v) => `${(v as number).toFixed(1)}%`} />
          <ReferenceLine y={meta.target} stroke="#888" strokeDasharray="3 3" label={`Target: ${meta.target}%`} />
          <Area type="monotone" dataKey="pct" stroke="#3b82f6" fill="#3b82f6" opacity={0.2} />
        </AreaChart>
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
  const monthData = month ? ds.months[month] : undefined;
  const breakdown = month ? queueBreakdown(monthData!, activeKpi) : {};

  if (!Object.keys(breakdown).length) return <Empty message="No queue data available" />;

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
              <TableHead className="text-right">Compliance %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(breakdown).map(([queue, data]) => (
              <TableRow key={queue}>
                <TableCell className="font-medium">{queue}</TableCell>
                <TableCell className="text-right">{data.tickets}</TableCell>
                <TableCell className="text-right text-red-600">{data.breaches}</TableCell>
                <TableCell className="text-right font-semibold">{data.pct.toFixed(1)}%</TableCell>
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
