import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { useData } from "@/context/DataContext";
import { kpiTrend } from "@/lib/aggregate";
import { KPIS, statusFor, formatPct, isLowerBetter } from "@/lib/kpiConfig";
import { cn } from "@/lib/utils";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const searchSchema = z.object({
  kpi: fallback(z.string(), "KSL-2c").default("KSL-2c"),
});

export const Route = createFileRoute("/trend")({
  ssr: false,
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "6-Week Trend · KPI Dashboard" },
      { name: "description", content: "Last 6 ISO weeks of KPI performance, Before and After exclusion overlaid." },
      { property: "og:title", content: "KPI 6-Week Trend" },
      { property: "og:description", content: "Weekly KPI trend with Before/After exclusion lines and target reference." },
    ],
  }),
  component: TrendPage,
});

function TrendPage() {
  const { workbook } = useData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const kpi = KPIS.find((k) => k.code === search.kpi) ?? KPIS[0];
  const lower = isLowerBetter(kpi);

  const data = useMemo(() => (workbook ? kpiTrend(workbook, kpi.code, 6) : []), [workbook, kpi]);

  if (!workbook) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No data yet — <Link to="/" className="text-primary underline">upload a file</Link>.</p>
      </main>
    );
  }

  const chartData = data.map((d) => ({
    week: d.weekLabel,
    before: d.before.total === 0 ? null : Math.round(d.before.pct * 1000) / 10,
    after: d.after.total === 0 ? null : Math.round(d.after.pct * 1000) / 10,
  }));

  const targetPct = kpi.target * 100;
  const yDomain: [number, number] = lower
    ? [0, Math.max(targetPct + 10, 20)]
    : [Math.max(0, targetPct - 15), 100];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">6-Week Trend</h1>
          <p className="mt-1 text-sm text-muted-foreground">{kpi.measures} · target {kpi.targetText}</p>
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
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 12 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip formatter={(v) => (v == null ? "—" : `${v}%`)} />
              <Legend />
              <ReferenceLine
                y={targetPct}
                stroke="#94a3b8"
                strokeDasharray="6 4"
                label={{ value: `Target ${targetPct.toFixed(0)}%`, position: "right", fontSize: 11 }}
              />
              <Line type="monotone" name="Before exclusion" dataKey="before" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" name="After exclusion" dataKey="after" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {data.map((d) => {
          const status = statusFor(kpi, d.after.pct);
          const styles = {
            good: "border-emerald-200 bg-emerald-50",
            watch: "border-amber-200 bg-amber-50",
            risk: "border-rose-200 bg-rose-50",
          }[status];
          return (
            <div key={d.weekKey} className={cn("rounded-xl border p-3", styles)}>
              <div className="text-xs text-muted-foreground">{d.weekLabel}</div>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Before</span>
                <span className="tabular-nums">{d.before.total === 0 ? "—" : formatPct(d.before.pct)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">After</span>
                <span className="text-base font-semibold tabular-nums">{d.after.total === 0 ? "—" : formatPct(d.after.pct)}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                breaches {d.before.breach}/{d.after.breach} · total {d.before.total}/{d.after.total}
              </div>
            </div>
          );
        })}
        {data.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No rows for {kpi.code} in this workbook.
          </div>
        )}
      </section>
    </main>
  );
}
