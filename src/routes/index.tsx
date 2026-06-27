import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowUp, BarChart3, ChevronRight, Download, FileSpreadsheet,
  Filter, Layers, LineChart as LineChartIcon, Loader2, Moon, Pin, RefreshCw,
  Sparkles, Sun, Target, TrendingUp, Upload, Users, X,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart,
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
  rawOverallByKpi, weekLabel, weeklySummary,
} from "@/lib/analyzer/compute";
import { exportDatasetWorkbook } from "@/lib/analyzer/export";
import { ExportMenu } from "@/components/ExportMenu";
import { PCMS_CATEGORIES, pcmsByCategory, pcmsTopAgents, pcmsWeeklyCounts, type PcmsRow } from "@/lib/analyzer/parsePcms";
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
  }, []);

  const removeFile = (slot: Slot, idx: number) =>
    setFiles((s) => ({ ...s, [slot]: s[slot].filter((_, i) => i !== idx) }));

  const canRun = files.sla.some((f) => !f.error);

  const runAnalysis = async () => {
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 50));
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

  const reset = () => { setDataset(null); setFiles({ sla: [], breach: [], excl: [] }); };

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
  files, onAdd, onRemove, onRun, canRun, busy,
}: {
  files: Record<Slot, LoadedFile[]>;
  onAdd: (slot: Slot, list: FileList | File[]) => void;
  onRemove: (slot: Slot, idx: number) => void;
  onRun: () => void;
  canRun: boolean;
  busy: boolean;
}) {
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
          Drop your SLA exports, optional enriched breaches and an exclusions list.
          Get KPI compliance, monthly &amp; weekly trends, queue drill-down and a side-by-side
          before/after exclusion view — instantly.
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

      <div className="mt-10 flex justify-center">
        <Button
          size="lg"
          disabled={!canRun || busy}
          onClick={onRun}
          className="group h-12 rounded-full bg-[image:var(--gradient-primary)] px-8 text-base font-semibold text-primary-foreground ring-glow transition hover:opacity-95 disabled:opacity-40"
        >
          {busy
            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Crunching…</>
            : <><Activity className="mr-2 h-4 w-4" /> Run analysis <ChevronRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" /></>}
        </Button>
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

function OverviewSection({ ds, month, detected }: { ds: Dataset; month: string | null; detected: KpiCode[] }) {
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
}

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

function KpiTile({ ds, code, month }: { ds: Dataset; code: KpiCode; month: string | null }) {
  const meta = KPI_META[code];
  const o = overallByKpi(ds, code, month);
  const raw = rawOverallByKpi(ds, code, month);
  const trend = useMemo(() => weeklySummary(ds, code, { lastN: 6 }), [ds, code]);
  const delta = o.rate - raw.rate;
  const showDelta = Math.abs(delta) > 0.05 && raw.total !== o.total;

  return (
    <div className="glass group relative flex flex-col gap-3 overflow-hidden rounded-2xl p-5 transition hover:translate-y-[-2px] hover:ring-glow">
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: meta.color }} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>{code}</p>
          <p className="mt-0.5 text-xs font-semibold leading-tight text-foreground">{meta.what}</p>
        </div>
        <RagBadge rag={o.rag} isKM={meta.isKM} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="font-display text-3xl font-bold tabular-nums" style={{ color: o.rag === "none" ? undefined : `var(--${o.rag === "green" ? "success" : o.rag === "amber" ? "warning" : "danger"})` }}>
            {o.display}
          </p>
          <p className="text-[10px] text-muted-foreground">Target {meta.targetLabel}</p>
          {showDelta && (
            <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              raw <span className="line-through">{raw.display}</span>
              {delta > 0
                ? <ArrowUp className="h-3 w-3 text-[color:var(--success)]" />
                : <ArrowDown className="h-3 w-3 text-[color:var(--danger)]" />}
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
        <span>{o.total.toLocaleString()} tickets</span>
        <span>{o.breaches.toLocaleString()} breaches</span>
      </div>
    </div>
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

/* ─────────────────────────────────────────────────── MONTHLY */

function MonthlySection({ ds, detected }: { ds: Dataset; detected: KpiCode[] }) {
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
}

/* ─────────────────────────────────────────────────── WEEKLY */

function WeeklySection({ ds, detected }: { ds: Dataset; detected: KpiCode[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {detected.map((code) => {
        const meta = KPI_META[code];
        const data = withDeltas(weeklySummary(ds, code).map((p) => ({ ...p, label: weekLabel(p.label) })));
        const amber = amberBound(meta);
        const dotColor = (rag: string) =>
          rag === "green" ? "var(--success)"
          : rag === "amber" ? "var(--warning)"
          : rag === "red" ? "var(--danger)"
          : "var(--muted-foreground)";
        return (
          <Panel key={code} title={`${code} · last 6 weeks`} subtitle={meta.what} badge={meta.targetLabel} exportName={`weekly_${code}`}>
            {data.length === 0
              ? <Empty message="No weekly data for this KPI." />
              : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data} margin={{ top: 32, right: 28, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${Math.round(v)}%`} domain={["auto", "auto"]} />
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
                        offset={12}
                        content={(props: any) => {
                          const { x, y, value, index } = props;
                          const row = data[index];
                          if (row == null || value == null) return null;
                          const delta = row.delta;
                          const arrow = delta == null ? "" : delta > 0.05 ? " ▲" : delta < -0.05 ? " ▼" : " ■";
                          const deltaColor = delta == null
                            ? "var(--muted-foreground)"
                            : (meta.isKM ? delta < 0 : delta > 0)
                              ? "var(--success)"
                              : delta === 0 ? "var(--muted-foreground)" : "var(--danger)";
                          return (
                            <g>
                              <text x={x} y={y} dy={-6} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: "var(--foreground)" }}>
                                {Number(value).toFixed(1)}%
                              </text>
                              {delta != null && (
                                <text x={x} y={y} dy={6} textAnchor="middle" style={{ fontSize: 9, fontWeight: 600, fill: deltaColor }}>
                                  {(delta > 0 ? "+" : "") + delta.toFixed(1) + "pp" + arrow}
                                </text>
                              )}
                            </g>
                          );
                        }}
                      />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              )}
          </Panel>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────── QUEUES */

function QueuesSection({
  ds, month, detected, activeKpi, setActiveKpi,
}: { ds: Dataset; month: string | null; detected: KpiCode[]; activeKpi: KpiCode; setActiveKpi: (k: KpiCode) => void }) {
  const safe = detected.includes(activeKpi) ? activeKpi : (detected[0] ?? "KSL-2c");
  const meta = KPI_META[safe];
  const data = queueBreakdown(ds, safe, month);
  const top = data.slice(0, 10);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">KPI</span>
        <Select value={safe} onValueChange={(v) => setActiveKpi(v as KpiCode)}>
          <SelectTrigger className="h-9 w-72 rounded-full glass">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {detected.map((c) => (
              <SelectItem key={c} value={c}>{c} — {KPI_META[c].what}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="ml-auto">{data.length} queues</Badge>
      </div>

      <Panel title={`${safe} · queue breakdown`} subtitle={meta.what} badge={meta.targetLabel} exportName={`queues_${safe}`}>
        {top.length === 0
          ? <Empty message="No queue data for this KPI and period." />
          : (
            <ResponsiveContainer width="100%" height={Math.max(260, top.length * 36)}>
              <BarChart data={top} layout="vertical" margin={{ top: 10, right: 24, left: 16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="queue" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={140} />
                <Tooltip content={<RichTip meta={meta} />} cursor={{ fill: "var(--muted)", opacity: 0.12 }} />
                <ReferenceLine
                  x={meta.target}
                  stroke="var(--success)"
                  strokeDasharray="5 4"
                  label={{ value: `target ${meta.targetLabel}`, fontSize: 10, fill: "var(--success)", position: "top" }}
                />
                <ReferenceLine
                  x={amberBound(meta)}
                  stroke="var(--warning)"
                  strokeDasharray="2 4"
                  label={{ value: meta.isKM ? "watch" : "watch", fontSize: 10, fill: "var(--warning)", position: "top" }}
                />
                <Bar dataKey="rate" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="rate" position="right" formatter={(v: number) => `${v.toFixed(1)}%`} style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }} />
                  {top.map((d, i) => (
                    <Cell key={i} fill={
                      d.rag === "green" ? "var(--success)"
                      : d.rag === "amber" ? "var(--warning)"
                      : d.rag === "red" ? "var(--danger)"
                      : "var(--muted)"
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
      </Panel>

      <Panel title="All queues" subtitle="Ranked by ticket volume">
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
              {data.map((q) => (
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
              {data.length === 0 && (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No queues for this filter.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  );
}

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
        {badge && <Badge variant="secondary" className="ml-auto text-[10px]">{badge}</Badge>}
        {exportName && <div className={cn(badge ? "" : "ml-auto")}><ExportMenu targetRef={ref} name={exportName} /></div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="py-10 text-center text-xs text-muted-foreground">{message}</p>;
}

function ChartTip({ active, payload, label, suffix = "" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-lg border border-border/60 px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="tabular-nums" style={{ color: p.color }}>
          {p.name ?? "value"}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}{suffix}
        </p>
      ))}
    </div>
  );
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
