import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useCallback, useRef, useMemo } from "react";
import Papa from "papaparse";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/queue")({ component: QueueAnalyzerPage });

/* ── palette (matches app design tokens) ─────────────────────── */
const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#7a39bb",
  "#d19900",
  "#a13544",
];

/* ── column-detection hints ───────────────────────────────────── */
const COL_HINTS: Record<string, string[]> = {
  id:          ["id","ticket_id","ticketid","case_id","number","ref","reference"],
  created:     ["created","created_at","createdat","date","open_date","opened","submitted","timestamp"],
  updated:     ["updated","updated_at","modified","resolved_at","closed_at","last_update"],
  status:      ["status","state","ticket_status"],
  queue:       ["queue","group","team","department","category","type"],
  agent:       ["agent","assigned","assignee","owner","handler","resolved_by","assigned_to"],
  subject:     ["subject","title","summary","description","issue"],
  priority:    ["priority","severity","urgency"],
  handle_time: ["handle_time","handling_time","duration","time_spent","resolution_time","ttr","tat","handle_time_h"],
};

function detectCol(headers: string[], key: string): string | null {
  const hints = COL_HINTS[key];
  const h = headers.map(x => x.toLowerCase().replace(/[\s_.\-]/g, ""));
  for (const hint of hints) {
    const norm = hint.replace(/[\s_.\-]/g, "");
    const idx = h.findIndex(x => x === norm || x.startsWith(norm) || norm.startsWith(x));
    if (idx > -1) return headers[idx];
  }
  return null;
}

/* ── types ────────────────────────────────────────────────────── */
type RawRow = Record<string, string>;
interface ColMap { [k: string]: string | null }
interface ParsedRow {
  _raw: RawRow;
  id?: string; created?: string; updated?: string;
  status?: string; queue?: string; agent?: string;
  subject?: string; priority?: string; handle_time?: string;
  _createdDate: Date | null;
  _updatedDate: Date | null;
  _handleHours: number | null;
}

/* ── helpers ──────────────────────────────────────────────────── */
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
function getWeekKey(d: Date) {
  const t = new Date(d); t.setHours(0,0,0,0); t.setDate(t.getDate() - t.getDay());
  return isoDate(t);
}
function groupCount<T>(arr: T[], fn: (x: T) => string): Record<string, number> {
  const m: Record<string, number> = {};
  arr.forEach(x => { const k = fn(x); m[k] = (m[k] || 0) + 1; });
  return m;
}
const isResolved = (s: string) => /resolv|closed|done|complet/i.test(s);
const isOpen     = (s: string) => /open|new|pending|progress/i.test(s);
const isBreach   = (s: string) => /breach|overdue|escalat/i.test(s);

/* ── demo data ────────────────────────────────────────────────── */
function buildDemo(): string {
  const QUEUES   = ["Billing","Technical Support","General Enquiry","Escalations","Returns"];
  const AGENTS   = ["Alice Martin","Bob Chen","Carlos Vega","Diana Patel","Ethan Brooks","Fiona Walsh","George Liu","Hannah Kim"];
  const STATUSES = ["Open","In Progress","Resolved","Closed","Escalated","Pending"];
  const SUBS     = ["Account access issue","Payment failed","Slow response","Wrong charge","Product return","Feature request","Login error","Billing query","Password reset","Shipping delay"];
  const PRIS     = ["Low","Medium","High","Critical"];
  const wRand = (w: number[]) => { let r = Math.random() * w.reduce((a,b)=>a+b,0); for(let i=0;i<w.length;i++){r-=w[i];if(r<=0)return i;} return w.length-1; };
  const rows: RawRow[] = [];
  const now = Date.now();
  for (let i = 0; i < 600; i++) {
    const created = new Date(now - Math.random() * 90 * 86400000);
    const handleH = Math.random() * 48 + 0.5;
    const updated = new Date(created.getTime() + handleH * 3600000);
    rows.push({
      ticket_id:    "TK-" + (10000 + i),
      created_at:   created.toISOString(),
      updated_at:   updated.toISOString(),
      status:       STATUSES[wRand([3,4,6,5,1,2])],
      queue:        QUEUES[Math.floor(Math.random() * QUEUES.length)],
      agent:        AGENTS[Math.floor(Math.random() * AGENTS.length)],
      subject:      SUBS[Math.floor(Math.random() * SUBS.length)],
      priority:     PRIS[Math.floor(Math.random() * PRIS.length)],
      handle_time_h: handleH.toFixed(2),
    });
  }
  const keys = Object.keys(rows[0]);
  return [keys.join(","), ...rows.map(r => keys.map(k => r[k]).join(","))].join("\n");
}

/* ── chart tooltip ────────────────────────────────────────────── */
const ChartTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="tabular-nums">
          {p.name}: <span className="font-semibold">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </p>
      ))}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════ */
export default function QueueAnalyzerPage() {
  const [rows,     setRows]     = useState<ParsedRow[]>([]);
  const [allRows,  setAllRows]  = useState<ParsedRow[]>([]);
  const [colMap,   setColMap]   = useState<ColMap>({});
  const [allCols,  setAllCols]  = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [drag,     setDrag]     = useState(false);

  /* filters */
  const [fQueue,  setFQueue]  = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fAgent,  setFAgent]  = useState("");
  const [fFrom,   setFFrom]   = useState("");
  const [fTo,     setFTo]     = useState("");

  /* tickets tab */
  const [tab,      setTab]      = useState("overview");
  const [tSearch,  setTSearch]  = useState("");
  const [tPage,    setTPage]    = useState(0);
  const [tPerPage, setTPerPage] = useState(25);

  const fileRef = useRef<HTMLInputElement>(null);

  /* ── parse ──────────────────────────────────────────────────── */
  const parseCSV = useCallback((text: string, name: string) => {
    const result = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
    const raw = result.data;
    if (!raw.length) return;
    const headers = result.meta.fields ?? Object.keys(raw[0]);
    const cm: ColMap = {};
    for (const k of Object.keys(COL_HINTS)) cm[k] = detectCol(headers, k);
    setColMap(cm); setAllCols(headers.slice(0, 12)); setFileName(name);
    const parsed: ParsedRow[] = raw.map(r => {
      const cd = cm.created ? new Date(r[cm.created] ?? "") : null;
      const ud = cm.updated ? new Date(r[cm.updated] ?? "") : null;
      let hh: number | null = null;
      if (cm.handle_time && r[cm.handle_time]) { const n = parseFloat(r[cm.handle_time]); if (!isNaN(n)) hh = n; }
      else if (cd && !isNaN(cd.getTime()) && ud && !isNaN(ud.getTime()) && ud > cd) hh = (ud.getTime() - cd.getTime()) / 3600000;
      return {
        _raw: r,
        id:          cm.id          ? r[cm.id]          ?? "" : "",
        created:     cm.created     ? r[cm.created]     ?? "" : "",
        updated:     cm.updated     ? r[cm.updated]     ?? "" : "",
        status:      cm.status      ? r[cm.status]      ?? "" : "",
        queue:       cm.queue       ? r[cm.queue]       ?? "" : "",
        agent:       cm.agent       ? r[cm.agent]       ?? "" : "",
        subject:     cm.subject     ? r[cm.subject]     ?? "" : "",
        priority:    cm.priority    ? r[cm.priority]    ?? "" : "",
        handle_time: cm.handle_time ? r[cm.handle_time] ?? "" : "",
        _createdDate: cd && !isNaN(cd.getTime()) ? cd : null,
        _updatedDate: ud && !isNaN(ud.getTime()) ? ud : null,
        _handleHours: hh,
      };
    });
    setAllRows(parsed);
    const dates = parsed.filter(r => r._createdDate).map(r => r._createdDate!).sort((a,b) => +a - +b);
    if (dates.length) { setFFrom(isoDate(dates[0])); setFTo(isoDate(dates[dates.length-1])); }
    setFQueue(""); setFStatus(""); setFAgent("");
    setRows(parsed); setTab("overview"); setTPage(0); setTSearch("");
  }, []);

  const handleFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = e => parseCSV(e.target?.result as string, f.name.replace(/\.csv$/i, ""));
    reader.readAsText(f);
  };

  /* ── filtered rows ──────────────────────────────────────────── */
  const filtered = useMemo(() => {
    const from = fFrom ? new Date(fFrom) : null;
    const to   = fTo   ? new Date(fTo + "T23:59:59") : null;
    return allRows.filter(r => {
      if (fQueue  && r.queue  !== fQueue)  return false;
      if (fStatus && r.status !== fStatus) return false;
      if (fAgent  && r.agent  !== fAgent)  return false;
      if (from && r._createdDate && r._createdDate < from) return false;
      if (to   && r._createdDate && r._createdDate > to)   return false;
      return true;
    });
  }, [allRows, fQueue, fStatus, fAgent, fFrom, fTo]);

  /* keep rows in sync with filtered */
  useMemo(() => setRows(filtered), [filtered]);

  /* ── unique filter options ──────────────────────────────────── */
  const uniq = (fn: (r: ParsedRow) => string) =>
    [...new Set(allRows.map(fn).filter(Boolean))].sort();
  const queues   = uniq(r => r.queue  ?? "");
  const statuses = uniq(r => r.status ?? "");
  const agents   = uniq(r => r.agent  ?? "");

  /* ── KPIs ───────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const total    = rows.length;
    const resolved = rows.filter(r => isResolved(r.status ?? "")).length;
    const open     = rows.filter(r => isOpen(r.status ?? "")).length;
    const htRows   = rows.filter(r => r._handleHours != null && r._handleHours > 0 && r._handleHours < 720);
    const avgHt    = htRows.length ? htRows.reduce((s, r) => s + r._handleHours!, 0) / htRows.length : null;
    const agentSet = new Set(rows.map(r => r.agent).filter(Boolean));
    const queueSet = new Set(rows.map(r => r.queue).filter(Boolean));
    return { total, resolved, open, avgHt, agentCount: agentSet.size, queueCount: queueSet.size,
      resRate: total ? Math.round(resolved / total * 100) : 0 };
  }, [rows]);

  /* ── chart data ─────────────────────────────────────────────── */
  const statusData = useMemo(() => {
    const m = groupCount(rows, r => r.status || "(unknown)");
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const queueData = useMemo(() => {
    const m = groupCount(rows, r => r.queue || "(none)");
    return Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0,12).map(([name,value]) => ({ name, value }));
  }, [rows]);

  const dailyData = useMemo(() => {
    const m: Record<string,number> = {};
    rows.forEach(r => { if (r._createdDate) { const k = isoDate(r._createdDate); m[k] = (m[k]||0)+1; } });
    return Object.keys(m).sort().map(date => ({ date, tickets: m[date] }));
  }, [rows]);

  const hourData = useMemo(() => {
    const h = Array(24).fill(0);
    rows.forEach(r => { if (r._createdDate) h[r._createdDate.getHours()]++; });
    return h.map((v,i) => ({ hour: String(i).padStart(2,"0")+":00", tickets: v }));
  }, [rows]);

  const agentData = useMemo(() => {
    const m: Record<string,{total:number,resolved:number,open:number,htSum:number,htCount:number}> = {};
    rows.forEach(r => {
      const a = r.agent || "(unassigned)";
      if (!m[a]) m[a] = { total:0, resolved:0, open:0, htSum:0, htCount:0 };
      m[a].total++;
      if (isResolved(r.status??"" )) m[a].resolved++;
      else m[a].open++;
      if (r._handleHours != null && r._handleHours > 0 && r._handleHours < 720) { m[a].htSum += r._handleHours; m[a].htCount++; }
    });
    return Object.entries(m).sort((a,b)=>b[1].total-a[1].total).slice(0,15).map(([agent,d]) => ({
      agent,
      total: d.total, resolved: d.resolved, open: d.open,
      resRate: d.total ? Math.round(d.resolved/d.total*100) : 0,
      avgHt: d.htCount ? +(d.htSum/d.htCount).toFixed(1) : null,
    }));
  }, [rows]);

  const queueStackData = useMemo(() => {
    const m: Record<string,{resolved:number,open:number,htSum:number,htCount:number,agents:Record<string,number>}> = {};
    rows.forEach(r => {
      const q = r.queue || "(none)";
      if (!m[q]) m[q] = { resolved:0, open:0, htSum:0, htCount:0, agents:{} };
      if (isResolved(r.status??"" )) m[q].resolved++; else m[q].open++;
      if (r._handleHours != null && r._handleHours>0 && r._handleHours<720) { m[q].htSum+=r._handleHours; m[q].htCount++; }
      if (r.agent) m[q].agents[r.agent] = (m[q].agents[r.agent]||0)+1;
    });
    return Object.entries(m).sort((a,b) => (b[1].resolved+b[1].open)-(a[1].resolved+a[1].open)).map(([queue,d]) => ({
      queue,
      resolved: d.resolved, open: d.open,
      avgHt: d.htCount ? +(d.htSum/d.htCount).toFixed(1) : 0,
      topAgent: Object.entries(d.agents).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "—",
    }));
  }, [rows]);

  const weeklyData = useMemo(() => {
    const m: Record<string,number> = {};
    rows.forEach(r => { if(r._createdDate){const k=getWeekKey(r._createdDate); m[k]=(m[k]||0)+1;} });
    return Object.keys(m).sort().map(week => ({ week, tickets: m[week] }));
  }, [rows]);

  const dowData = useMemo(() => {
    const d = Array(7).fill(0);
    rows.forEach(r => { if(r._createdDate) d[r._createdDate.getDay()]++; });
    return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,i) => ({ day, tickets: d[i] }));
  }, [rows]);

  const statusTrendData = useMemo(() => {
    const statusList = [...new Set(rows.map(r=>r.status||'').filter(Boolean))].slice(0,5);
    const monthMap: Record<string,Record<string,number>> = {};
    rows.forEach(r => {
      if(!r._createdDate) return;
      const mo = r._createdDate.toISOString().slice(0,7);
      if(!monthMap[mo]) monthMap[mo]={};
      if(r.status) monthMap[mo][r.status]=(monthMap[mo][r.status]||0)+1;
    });
    const months = Object.keys(monthMap).sort();
    return { months: months.map(m => ({ month: m, ...monthMap[m] })), statusList };
  }, [rows]);

  /* ── tickets tab ────────────────────────────────────────────── */
  const ticketRows = useMemo(() => {
    const q = tSearch.toLowerCase();
    if (!q) return rows;
    return rows.filter(r => allCols.some(c => (r._raw[c]||'').toLowerCase().includes(q)));
  }, [rows, tSearch, allCols]);
  const tPages = Math.ceil(ticketRows.length / tPerPage) || 1;
  const tStart = tPage * tPerPage;
  const tPageRows = ticketRows.slice(tStart, tStart + tPerPage);

  /* ── summary dates ──────────────────────────────────────────── */
  const allDates = allRows.filter(r=>r._createdDate).map(r=>r._createdDate!).sort((a,b)=>+a-+b);
  const dateSpan = allDates.length >= 2 ? `${fmtDate(allDates[0])} – ${fmtDate(allDates[allDates.length-1])}` : "";

  /* ── reset ──────────────────────────────────────────────────── */
  const reset = () => { setAllRows([]); setRows([]); setFileName(""); setTab("overview"); };

  const hasData = allRows.length > 0;

  /* ══════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-background">

      {/* ── HEADER ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-screen-xl items-center gap-4 px-6 h-14">
          <Link to="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            ← KPI Hub
          </Link>
          <span className="text-muted-foreground/40">|</span>
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 28 28" fill="none" className="shrink-0">
              <rect x="2" y="6"  width="24" height="4" rx="2" fill="hsl(var(--primary))" opacity=".3"/>
              <rect x="2" y="12" width="24" height="4" rx="2" fill="hsl(var(--primary))" opacity=".6"/>
              <rect x="2" y="18" width="17" height="4" rx="2" fill="hsl(var(--primary))"/>
              <circle cx="24" cy="20" r="4" fill="hsl(var(--primary))"/>
            </svg>
            <span className="font-semibold text-sm">Queue Analyzer</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {hasData && (
              <>
                <label htmlFor="qa-file" className="cursor-pointer inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                  <UploadIcon /> Upload CSV
                </label>
                <button onClick={reset} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  <RefreshIcon /> New file
                </button>
                <button
                  onClick={() => {
                    const cols = allCols;
                    const csv = [cols.join(","), ...rows.map(r => cols.map(c => JSON.stringify(r._raw[c]||"")||'""').join(","))].join("\n");
                    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
                    a.download = "queue-export.csv"; a.click();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <DownloadIcon /> Export
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <input ref={fileRef} id="qa-file" type="file" accept=".csv" className="sr-only"
        onChange={e => { const f=e.target.files?.[0]; if(f) handleFile(f); e.target.value=""; }}/>

      <main className="mx-auto max-w-screen-xl px-6 py-8">

        {/* ── UPLOAD SCREEN ─────────────────────────────────── */}
        {!hasData && (
          <div
            onDragOver={e=>{e.preventDefault();setDrag(true);}}
            onDragLeave={()=>setDrag(false)}
            onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f?.name.endsWith(".csv"))handleFile(f);}}
          >
            <label
              htmlFor="qa-file"
              className={`flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-8 py-24 text-center cursor-pointer transition-colors ${
                drag ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary hover:bg-primary/5"
              }`}
            >
              <svg className="h-12 w-12 text-muted-foreground/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <div>
                <h2 className="text-xl font-semibold">Drop your queue CSV here</h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-xs mx-auto">Upload a CSV export from your ticketing system. Columns are auto-detected.</p>
              </div>
              <span className="pointer-events-none rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Choose File</span>
              <p className="text-xs text-muted-foreground/60">Processed entirely in your browser · No data leaves this page</p>
            </label>
            <div className="mt-8">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">Or try with sample data</p>
              <button
                onClick={() => parseCSV(buildDemo(), "Demo Queue Dataset")}
                className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                Load demo dataset
              </button>
            </div>
          </div>
        )}

        {/* ── DASHBOARD ─────────────────────────────────────── */}
        {hasData && (
          <div>
            {/* title */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">{fileName || "Queue Analysis"}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {allRows.length.toLocaleString()} tickets{dateSpan && ` · ${dateSpan}`}
              </p>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {[
                { label:"Total Tickets",  value: kpis.total.toLocaleString(),   sub: "in selection",             accent: "text-primary" },
                { label:"Open",           value: kpis.open.toLocaleString(),    sub: `${kpis.total ? Math.round(kpis.open/kpis.total*100):0}% of total`, accent: "text-amber-600 dark:text-amber-400" },
                { label:"Resolved",       value: kpis.resolved.toLocaleString(), sub: `${kpis.resRate}% res. rate`, accent: "text-emerald-600 dark:text-emerald-400" },
                { label:"Avg Handle",     value: kpis.avgHt != null ? kpis.avgHt.toFixed(1)+"h" : "—", sub: "per ticket", accent: "text-blue-600 dark:text-blue-400" },
                { label:"Active Agents",  value: kpis.agentCount.toLocaleString(), sub: "in selection",          accent: "" },
                { label:"Queues",         value: kpis.queueCount.toLocaleString(), sub: "in selection",          accent: "" },
              ].map(k => (
                <div key={k.label} className="rounded-lg border bg-card px-4 py-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{k.label}</p>
                  <p className={`text-2xl font-bold tabular-nums leading-none ${k.accent}`}>{k.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{k.sub}</p>
                </div>
              ))}
            </div>

            {/* filter bar */}
            <div className="flex flex-wrap gap-3 items-end mb-6">
              {[
                { label:"Queue",  id:"fq",  val:fQueue,  set:setFQueue,  opts:queues },
                { label:"Status", id:"fs",  val:fStatus, set:setFStatus, opts:statuses },
                { label:"Agent",  id:"fa",  val:fAgent,  set:setFAgent,  opts:agents },
              ].map(f => (
                <div key={f.id} className="flex flex-col gap-1">
                  <label htmlFor={f.id} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</label>
                  <select id={f.id} value={f.val} onChange={e=>f.set(e.target.value)}
                    className="rounded-md border bg-card px-3 py-1.5 text-sm min-w-[140px] focus:ring-1 focus:ring-ring">
                    <option value="">All {f.label.toLowerCase()}s</option>
                    {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <label htmlFor="ff" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">From</label>
                <input id="ff" type="date" value={fFrom} onChange={e=>setFFrom(e.target.value)}
                  className="rounded-md border bg-card px-3 py-1.5 text-sm focus:ring-1 focus:ring-ring"/>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="ft" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">To</label>
                <input id="ft" type="date" value={fTo} onChange={e=>setFTo(e.target.value)}
                  className="rounded-md border bg-card px-3 py-1.5 text-sm focus:ring-1 focus:ring-ring"/>
              </div>
              <button onClick={()=>{setFQueue('');setFStatus('');setFAgent('');
                if(allDates.length){setFFrom(isoDate(allDates[0]));setFTo(isoDate(allDates[allDates.length-1]));}}}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent self-end transition-colors">
                Clear
              </button>
            </div>

            {/* tabs */}
            <div className="flex gap-0.5 border-b mb-6">
              {["overview","agents","queues","trends","tickets"].map(t => (
                <button key={t} onClick={()=>{setTab(t);setTPage(0);}}
                  className={`px-4 py-2 text-sm font-medium capitalize rounded-t-md border-b-2 transition-colors ${
                    tab===t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}>{t}
                </button>
              ))}
            </div>

            {/* ── TAB: OVERVIEW ─────────────────────────────── */}
            {tab==="overview" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartPanel title="Volume by Status">
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                        {statusData.map((_,i) => <Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                      </Pie><Tooltip content={<ChartTip/>}/></PieChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                  <ChartPanel title="Volume by Queue">
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={queueData} layout="vertical" margin={{left:8,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis type="number" tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <YAxis type="category" dataKey="name" width={110} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>}/>
                        <Bar dataKey="value" name="Tickets" fill={COLORS[0]} radius={[0,4,4,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                </div>
                <ChartPanel title="Daily Ticket Volume">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={dailyData} margin={{left:0,right:16,top:4,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                      <XAxis dataKey="date" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))" tickLine={false} interval={Math.max(0,Math.floor(dailyData.length/12)-1)}/>
                      <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))" tickLine={false}/>
                      <Tooltip content={<ChartTip/>}/>
                      <Line type="monotone" dataKey="tickets" stroke={COLORS[0]} strokeWidth={2} dot={dailyData.length>60?false:{r:2}} activeDot={{r:4}}/>
                    </LineChart>
                  </ResponsiveContainer>
                </ChartPanel>
                <ChartPanel title="Hour of Day Distribution">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={hourData} margin={{left:0,right:16,top:4,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                      <XAxis dataKey="hour" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))" tickLine={false} interval={3}/>
                      <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))" tickLine={false}/>
                      <Tooltip content={<ChartTip/>}/>
                      <Bar dataKey="tickets" fill={COLORS[2]} radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartPanel>
              </div>
            )}

            {/* ── TAB: AGENTS ──────────────────────────────── */}
            {tab==="agents" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartPanel title="Tickets per Agent">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={agentData} layout="vertical" margin={{left:8,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis type="number" tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <YAxis type="category" dataKey="agent" width={110} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>}/>
                        <Bar dataKey="total" name="Total" fill={COLORS[0]} radius={[0,4,4,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                  <ChartPanel title="Resolution Rate by Agent (%)">
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={agentData} layout="vertical" margin={{left:8,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis type="number" domain={[0,100]} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))" tickFormatter={v=>v+"%"}/>
                        <YAxis type="category" dataKey="agent" width={110} tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>} formatter={(v:any)=>v+"%"}/>
                        <Bar dataKey="resRate" name="Res. Rate %" fill={COLORS[4]} radius={[0,4,4,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                </div>
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-5 py-4 border-b font-semibold text-sm">Agent Performance Table</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>{["Agent","Total","Resolved","Open","Res. Rate","Avg Handle (h)"].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y">
                        {agentData.map(a => (
                          <tr key={a.agent} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-medium">{a.agent}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{a.total}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{a.resolved}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{a.open}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                a.resRate>=80?"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400":
                                a.resRate>=50?"bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400":
                                              "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              }`}>{a.resRate}%</span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{a.avgHt ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB: QUEUES ──────────────────────────────── */}
            {tab==="queues" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartPanel title="Queue Breakdown — Open vs Resolved">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={queueStackData} margin={{left:0,right:16,top:4,bottom:40}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis dataKey="queue" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))" angle={-30} textAnchor="end" interval={0}/>
                        <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>}/>
                        <Legend wrapperStyle={{fontSize:11}} formatter={(v:string)=>v}/>
                        <Bar dataKey="resolved" name="Resolved" stackId="a" fill={COLORS[4]}/>
                        <Bar dataKey="open"     name="Open"     stackId="a" fill={COLORS[1]} radius={[4,4,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                  <ChartPanel title="Avg Handling Time by Queue (h)">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={queueStackData} margin={{left:0,right:16,top:4,bottom:40}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis dataKey="queue" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))" angle={-30} textAnchor="end" interval={0}/>
                        <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>}/>
                        <Bar dataKey="avgHt" name="Avg Handle (h)" fill={COLORS[2]} radius={[4,4,0,0]}/>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                </div>
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="px-5 py-4 border-b font-semibold text-sm">Queue Summary</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>{["Queue","Tickets","Open","Resolved","Avg Handle (h)","Top Agent"].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y">
                        {queueStackData.map(q => (
                          <tr key={q.queue} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2.5 font-medium">{q.queue}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{q.resolved+q.open}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{q.open}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{q.resolved}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{q.avgHt||"—"}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{q.topAgent}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB: TRENDS ──────────────────────────────── */}
            {tab==="trends" && (
              <div className="space-y-4">
                <ChartPanel title="Weekly Volume Trend">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={weeklyData} margin={{left:0,right:16,top:4,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                      <XAxis dataKey="week" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))" interval={Math.max(0,Math.floor(weeklyData.length/10)-1)}/>
                      <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                      <Tooltip content={<ChartTip/>}/>
                      <Line type="monotone" dataKey="tickets" name="Tickets/week" stroke={COLORS[0]} strokeWidth={2} dot={{r:3}} activeDot={{r:5}}/>
                    </LineChart>
                  </ResponsiveContainer>
                </ChartPanel>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ChartPanel title="Day of Week Pattern">
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={dowData} margin={{left:0,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis dataKey="day" tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>}/>
                        <Bar dataKey="tickets" radius={[4,4,0,0]}>
                          {dowData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                  <ChartPanel title="Status Trend (Monthly)">
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={statusTrendData.months} margin={{left:0,right:16,top:4,bottom:4}}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
                        <XAxis dataKey="month" tick={{fontSize:10}} stroke="hsl(var(--muted-foreground))"/>
                        <YAxis tick={{fontSize:11}} stroke="hsl(var(--muted-foreground))"/>
                        <Tooltip content={<ChartTip/>}/>
                        <Legend wrapperStyle={{fontSize:10}}/>
                        {statusTrendData.statusList.map((s,i) => (
                          <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i%COLORS.length]} strokeWidth={1.5} dot={false} activeDot={{r:3}}/>
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartPanel>
                </div>
              </div>
            )}

            {/* ── TAB: TICKETS ─────────────────────────────── */}
            {tab==="tickets" && (
              <div>
                <div className="flex flex-wrap gap-3 items-end mb-4">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="ts" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Search</label>
                    <input id="ts" type="text" placeholder="Ticket ID, agent, subject…" value={tSearch}
                      onChange={e=>{setTSearch(e.target.value);setTPage(0);}}
                      className="rounded-md border bg-card px-3 py-1.5 text-sm min-w-[220px] focus:ring-1 focus:ring-ring"/>
                  </div>
                  <div className="flex flex-col gap-1 ml-auto">
                    <label htmlFor="tpp" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rows</label>
                    <select id="tpp" value={tPerPage} onChange={e=>{setTPerPage(+e.target.value);setTPage(0);}}
                      className="rounded-md border bg-card px-3 py-1.5 text-sm focus:ring-1 focus:ring-ring">
                      <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
                    </select>
                  </div>
                </div>
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>{allCols.map(c => <th key={c} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap">{c}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y">
                        {tPageRows.map((r, i) => (
                          <tr key={i} className={`hover:bg-muted/30 transition-colors ${ isBreach(r.status??'') ? 'border-l-2 border-l-destructive bg-destructive/5' : '' }`}>
                            {allCols.map(c => <td key={c} className="px-4 py-2 whitespace-nowrap max-w-[200px] truncate">{r._raw[c]??""}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between px-5 py-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      Showing {tStart+1}–{Math.min(tStart+tPerPage,ticketRows.length)} of {ticketRows.length.toLocaleString()} tickets
                    </span>
                    <div className="flex gap-2">
                      <button disabled={tPage===0} onClick={()=>setTPage(p=>p-1)}
                        className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-40 hover:bg-accent transition-colors">‹ Prev</button>
                      <button disabled={tPage>=tPages-1} onClick={()=>setTPage(p=>p+1)}
                        className="rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-40 hover:bg-accent transition-colors">Next ›</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </main>
    </div>
  );
}

/* ── small reusable chart panel ─────────────────────────────── */
function ChartPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b">
        <h2 className="font-semibold text-sm">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ── micro icons ────────────────────────────────────────────── */
function UploadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
}
function RefreshIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.63"/></svg>;
}
function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
