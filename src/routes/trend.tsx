import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { useData } from "@/context/DataContext";
import { trendByKpi } from "@/lib/aggregate";
import { KPIS, LOWER_IS_BETTER, statusFor } from "@/lib/kpiConfig";
import { cn } from "@/lib/utils";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const searchSchema = z.object({ kpi: z.string().optional() });

export const Route = createFileRoute("/trend")({
  ssr: false,
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "6-Week Trend · KPI Dashboard" },
      { name: "description", content: "Last 6 ISO weeks of KPI compliance with target reference line." },
      { property: "og:title", content: "KPI 6-Week Trend" },
      { property: "og:description", content: "Weekly KPI compliance trend over the last 6 weeks." },
    ],
  }),
  component: TrendPage,
});

function TrendPage() {
  const { active } = useData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const kpiCode = search.kpi ?? "KSL-2c";
  const kpi = KPIS.find((k) => k.code === kpiCode) ?? KPIS[0];
  const isLower = LOWER_IS_BETTER.has(kpi.code);

  const data = useMemo(() => (active ? trendByKpi(active, kpi, 6) : []), [active, kpi]);
  const latest = data[data.length - 1];
  const totals = data.reduce(
    (acc, d) => ({ tickets: acc.tickets + d.tickets, breaches: acc.breaches + d.breaches }),
    { tickets: 0, breaches: 0 },
  );

  if (!active) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No data yet — <Link to="/" className="text-primary underline">upload a file</Link>.</p>
      </main>
    );
  }

  const chartData = data.map((d) => ({
    week: d.weekLabel,
    value: d.tickets === 0 ? null : Math.round(d.rate * 1000) / 10,
    target: kpi.target * 100,
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">6-Week Trend</h1>
          <p className="mt-1 text-sm text-muted-foreground">{kpi.measures} · {kpi.targetText}</p>
        </div>
        <select
          value={kpi.code}
          onChange={(e) => navigate({ search: { kpi: e.target.value } })}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {KPIS.map((k) => (
            <option key={k.code} value={k.code}>{k.code} — {k.label}</option>
          ))}
        </select>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            Latest: <span className="font-semibold text-foreground">{latest?.tickets === 0 ? "—" : `${(latest?.rate ?? 0 * 100).toFixed(1)}%`}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {totals.tickets.toLocaleString()} tickets · {totals.breaches.toLocaleString()} breaches
          </div>
        </div>
        <div className="mt-4 h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                domain={isLower ? [0, 100] : [Math.max(0, kpi.target * 100 - 15), 100]}
                tick={{ fontSize: 12 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip formatter={(v: any) => (v == null ? "—" : `${v}%`)} />
              <ReferenceLine y={kpi.target * 100} stroke="#94a3b8" strokeDasharray="6 4" label={{ value: `${(kpi.target * 100).toFixed(0)}`, position: "right", fontSize: 11 }} />
              <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.map((d) => {
          const status = statusFor(kpi, d.rate);
          const styles = {
            good: "border-emerald-200 bg-emerald-50",
            watch: "border-amber-200 bg-amber-50",
            risk: "border-rose-200 bg-rose-50",
          }[status];
          return (
            <div key={d.weekKey} className={cn("rounded-xl border p-4", styles)}>
              <div className="text-xs text-muted-foreground">{d.weekLabel}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {d.tickets === 0 ? "—" : `${(d.rate * 100).toFixed(1)}%`}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {d.tickets.toLocaleString()} tickets · {d.breaches.toLocaleString()} breaches
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
