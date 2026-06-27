import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useData } from "@/context/DataContext";
import { overallByKpi } from "@/lib/aggregate";
import { KpiGrid } from "@/components/KpiCard";
import { KPIS, statusFor, formatPct } from "@/lib/kpiConfig";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/overview")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Overview · KPI Dashboard" },
      { name: "description", content: "All KPIs at a glance with Before/After exclusion side-by-side." },
      { property: "og:title", content: "KPI Overview" },
      { property: "og:description", content: "All KPIs at a glance: KSL and KM compliance with Before/After exclusion." },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const { workbook } = useData();
  const navigate = useNavigate();
  const agg = useMemo(() => (workbook ? overallByKpi(workbook) : null), [workbook]);

  if (!workbook || !agg) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No data yet — <Link to="/" className="text-primary underline">upload a file</Link>.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Each card shows the KPI Before and After exclusion. Click any card to open its 6-week trend.</p>
      <div className="mt-6">
        <KpiGrid data={agg} onSelect={(k) => navigate({ to: "/trend", search: { kpi: k.code } })} />
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">All KPIs · Before vs After exclusion</h2>
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>KPI</TableHead>
                <TableHead>What it measures</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Before %</TableHead>
                <TableHead className="text-right">After %</TableHead>
                <TableHead className="text-right">Breaches B / A</TableHead>
                <TableHead className="text-right">Total B / A</TableHead>
                <TableHead>Status (After)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KPIS.map((k) => {
                const a = agg[k.code];
                const status = statusFor(k, a.after.pct);
                const variant = status === "good" ? "default" : status === "watch" ? "secondary" : "destructive";
                return (
                  <TableRow key={k.code}>
                    <TableCell className="font-medium">{k.code}</TableCell>
                    <TableCell className="text-muted-foreground">{k.measures}</TableCell>
                    <TableCell className="text-muted-foreground">{k.targetText}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.before.total === 0 ? "—" : formatPct(a.before.pct)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{a.after.total === 0 ? "—" : formatPct(a.after.pct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.before.breach} / {a.after.breach}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.before.total} / {a.after.total}</TableCell>
                    <TableCell>
                      <Badge variant={variant as "default" | "secondary" | "destructive"} className="uppercase tracking-wide">
                        {status === "good" ? "On target" : status === "watch" ? "Watch" : "Risk"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </main>
  );
}
