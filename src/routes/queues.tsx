import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { byMarket, byQueue, filterRows, trendByKpi } from "@/lib/aggregate";
import { KPIS, LOWER_IS_BETTER, statusFor } from "@/lib/kpiConfig";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/queues")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Per Queue / Market · KPI Dashboard" },
      { name: "description", content: "KPI breakdown by queue and market (derived from ISO_Language)." },
      { property: "og:title", content: "KPI Per Queue / Market" },
      { property: "og:description", content: "Drill into compliance by queue and market." },
    ],
  }),
  component: QueuesPage,
});

function QueuesPage() {
  const { active } = useData();
  const [marketFilter, setMarketFilter] = useState<string>("");
  const [kpiFilter, setKpiFilter] = useState<string>("KSL-2c");
  const [openQueue, setOpenQueue] = useState<string | null>(null);

  const markets = useMemo(() => (active ? byMarket(active) : []), [active]);
  const queues = useMemo(() => {
    if (!active) return [];
    const all = byQueue(active);
    return marketFilter ? all.filter((q) => q.market === marketFilter) : all;
  }, [active, marketFilter]);

  const kpi = KPIS.find((k) => k.code === kpiFilter) ?? KPIS[0];

  const drillData = useMemo(() => {
    if (!active || !openQueue) return [];
    return trendByKpi(filterRows(active, { queue: openQueue }), kpi, 6);
  }, [active, openQueue, kpi]);

  if (!active) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No data yet — <Link to="/" className="text-primary underline">upload a file</Link>.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Per Queue / Market</h1>
      <p className="mt-1 text-sm text-muted-foreground">Markets are derived from ISO_Language. Click a queue for its 6-week trend.</p>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Markets</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMarketFilter("")}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              !marketFilter ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            All ({markets.length})
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
              {m.market} · {m.queues} queues
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-xs text-muted-foreground">KPI column:</label>
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
                <TableHead>Queue</TableHead>
                <TableHead>Market</TableHead>
                {KPIS.map((k) => (
                  <TableHead key={k.code} className="text-right whitespace-nowrap">{k.code}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.map((q) => (
                <TableRow key={q.queue} className="cursor-pointer hover:bg-secondary/50" onClick={() => setOpenQueue(q.queue)}>
                  <TableCell className="font-medium">{q.queue}</TableCell>
                  <TableCell className="text-muted-foreground">{q.market}</TableCell>
                  {KPIS.map((k) => {
                    const a = q.agg[k.code];
                    const status = statusFor(k, a.rate);
                    const color = status === "good" ? "text-emerald-700" : status === "watch" ? "text-amber-700" : "text-rose-700";
                    return (
                      <TableCell key={k.code} className={cn("text-right tabular-nums", color)}>
                        {a.tickets === 0 ? "—" : `${(a.rate * 100).toFixed(1)}%`}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Sheet open={!!openQueue} onOpenChange={(o) => !o && setOpenQueue(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{openQueue}</SheetTitle>
          </SheetHeader>
          {openQueue && (
            <div className="mt-4 space-y-4">
              <div className="text-xs text-muted-foreground">{kpi.code} — {kpi.label}</div>
              <div className="h-64">
                <ResponsiveContainer>
                  <LineChart
                    data={drillData.map((d) => ({ week: d.weekLabel, value: d.tickets === 0 ? null : Math.round(d.rate * 1000) / 10 }))}
                    margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis domain={[Math.max(0, kpi.target * 100 - 15), 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: any) => (v == null ? "—" : `${v}%`)} />
                    <ReferenceLine y={kpi.target * 100} stroke="#94a3b8" strokeDasharray="6 4" />
                    <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {drillData.map((d) => {
                  const status = statusFor(kpi, d.rate);
                  const styles = {
                    good: "border-emerald-200 bg-emerald-50",
                    watch: "border-amber-200 bg-amber-50",
                    risk: "border-rose-200 bg-rose-50",
                  }[status];
                  return (
                    <div key={d.weekKey} className={cn("rounded-lg border p-2", styles)}>
                      <div className="text-[10px] text-muted-foreground">{d.weekLabel}</div>
                      <div className="text-sm font-semibold tabular-nums">{d.tickets === 0 ? "—" : `${(d.rate * 100).toFixed(1)}%`}</div>
                      <div className="text-[10px] text-muted-foreground">{d.tickets} · {d.breaches}b</div>
                    </div>
                  );
                })}
              </div>
              <div>
                <Badge variant="secondary">All KPIs</Badge>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {KPIS.map((k) => {
                    const a = byQueue(active).find((x) => x.queue === openQueue)?.agg[k.code];
                    if (!a) return null;
                    const status = statusFor(k, a.rate);
                    const color = status === "good" ? "text-emerald-700" : status === "watch" ? "text-amber-700" : "text-rose-700";
                    return (
                      <div key={k.code} className="rounded border border-border p-2">
                        <div className="text-[10px] text-muted-foreground">{k.code}</div>
                        <div className={cn("font-semibold tabular-nums", color)}>{a.tickets === 0 ? "—" : `${(a.rate * 100).toFixed(1)}%`}</div>
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
