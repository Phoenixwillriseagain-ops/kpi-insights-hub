import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { kpiTrend, queueMatrix, marketBreakdown } from "@/lib/aggregate";
import { KPIS, statusFor, formatPct, isLowerBetter } from "@/lib/kpiConfig";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/queues")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Per Queue / Market · KPI Dashboard" },
      { name: "description", content: "KPI breakdown by queue and market with Before/After exclusion." },
      { property: "og:title", content: "KPI Per Queue / Market" },
      { property: "og:description", content: "Drill into compliance by queue and market — Before and After exclusion." },
    ],
  }),
  component: QueuesPage,
});

function QueuesPage() {
  const { workbook } = useData();
  const [marketFilter, setMarketFilter] = useState<string>("");
  const [kpiFilter, setKpiFilter] = useState<string>("KSL-2c");
  const [openQueue, setOpenQueue] = useState<string | null>(null);

  const kpi = KPIS.find((k) => k.code === kpiFilter) ?? KPIS[0];
  const lower = isLowerBetter(kpi);

  const markets = useMemo(() => (workbook ? marketBreakdown(workbook, kpi.code) : []), [workbook, kpi]);
  const matrix = useMemo(() => (workbook ? queueMatrix(workbook, marketFilter || undefined) : []), [workbook, marketFilter]);

  const drillData = useMemo(() => {
    if (!workbook || !openQueue) return [];
    return kpiTrend(workbook, kpi.code, 6, { queue: openQueue });
  }, [workbook, openQueue, kpi]);

  if (!workbook) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No data yet — <Link to="/" className="text-primary underline">upload a file</Link>.</p>
      </main>
    );
  }

  const targetPct = kpi.target * 100;
  const yDomain: [number, number] = lower
    ? [0, Math.max(targetPct + 10, 20)]
    : [Math.max(0, targetPct - 15), 100];

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Per Queue / Market</h1>
      <p className="mt-1 text-sm text-muted-foreground">Markets are derived from <code>ISO_Language</code>. Cells show After-exclusion %; tooltip and drill-down show Before vs After.</p>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Markets (for {kpi.code})</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMarketFilter("")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              !marketFilter ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            All
          </button>
          {markets.map((m) => (
            <button
              key={m.market}
              onClick={() => setMarketFilter(m.market)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                marketFilter === m.market ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
              )}
            >
              {m.market} · {m.queueCount} queues · {m.ba.after.total === 0 ? "—" : formatPct(m.ba.after.pct)}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground">Drill-down KPI:</label>
        <select
          value={kpi.code}
          onChange={(e) => setKpiFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {KPIS.map((k) => (
            <option key={k.code} value={k.code}>{k.code} — {k.label}</option>
          ))}
        </select>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card">Queue</TableHead>
                <TableHead>Market</TableHead>
                {KPIS.map((k) => (
                  <TableHead key={k.code} className="text-right whitespace-nowrap">{k.code}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.map((q) => (
                <TableRow key={q.queue} className="cursor-pointer hover:bg-secondary/50" onClick={() => setOpenQueue(q.queue)}>
                  <TableCell className="sticky left-0 bg-card font-medium">{q.queue}</TableCell>
                  <TableCell className="text-muted-foreground">{q.market}</TableCell>
                  {KPIS.map((k) => {
                    const ba = q.kpis[k.code];
                    const status = statusFor(k, ba.after.pct);
                    const color = status === "good" ? "text-emerald-700" : status === "watch" ? "text-amber-700" : "text-rose-700";
                    return (
                      <TableCell
                        key={k.code}
                        className={cn("text-right tabular-nums", color)}
                        title={`Before: ${ba.before.total === 0 ? "—" : formatPct(ba.before.pct)} (${ba.before.breach}/${ba.before.total})\nAfter: ${ba.after.total === 0 ? "—" : formatPct(ba.after.pct)} (${ba.after.breach}/${ba.after.total})`}
                      >
                        {ba.after.total === 0 ? "—" : formatPct(ba.after.pct)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {matrix.length === 0 && (
                <TableRow><TableCell colSpan={2 + KPIS.length} className="py-8 text-center text-sm text-muted-foreground">No queues found for this filter.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <Sheet open={!!openQueue} onOpenChange={(o) => !o && setOpenQueue(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{openQueue}</SheetTitle>
          </SheetHeader>
          {openQueue && (
            <div className="mt-4 space-y-5">
              <div className="text-xs text-muted-foreground">{kpi.code} — {kpi.label} · target {kpi.targetText}</div>
              <div className="h-64">
                <ResponsiveContainer>
                  <LineChart
                    data={drillData.map((d) => ({
                      week: d.weekLabel,
                      before: d.before.total === 0 ? null : Math.round(d.before.pct * 1000) / 10,
                      after: d.after.total === 0 ? null : Math.round(d.after.pct * 1000) / 10,
                    }))}
                    margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis domain={yDomain} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v) => (v == null ? "—" : `${v}%`)} />
                    <Legend />
                    <ReferenceLine y={targetPct} stroke="#94a3b8" strokeDasharray="6 4" />
                    <Line type="monotone" name="Before" dataKey="before" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    <Line type="monotone" name="After" dataKey="after" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All KPIs for this queue</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {KPIS.map((k) => {
                    const row = matrix.find((q) => q.queue === openQueue);
                    const ba = row?.kpis[k.code];
                    if (!ba) return null;
                    const status = statusFor(k, ba.after.pct);
                    const color = status === "good" ? "text-emerald-700" : status === "watch" ? "text-amber-700" : "text-rose-700";
                    return (
                      <div key={k.code} className="rounded border border-border p-2">
                        <div className="text-[10px] text-muted-foreground">{k.code}</div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground">Before</span>
                          <span className="tabular-nums text-xs">{ba.before.total === 0 ? "—" : formatPct(ba.before.pct)}</span>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground">After</span>
                          <span className={cn("font-semibold tabular-nums text-sm", color)}>{ba.after.total === 0 ? "—" : formatPct(ba.after.pct)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
