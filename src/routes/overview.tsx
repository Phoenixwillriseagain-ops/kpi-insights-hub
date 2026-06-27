import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { useData } from "@/context/DataContext";
import { overallByKpi } from "@/lib/aggregate";
import { KpiGrid, formatRate } from "@/components/KpiCard";
import { KPIS, LOWER_IS_BETTER, statusFor } from "@/lib/kpiConfig";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/overview")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Overview · KPI Dashboard" },
      { name: "description", content: "All KPIs at a glance with status, tickets, and breaches." },
      { property: "og:title", content: "KPI Overview" },
      { property: "og:description", content: "All KPIs at a glance: KSL and KM compliance." },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const { active } = useData();
  const navigate = useNavigate();
  const agg = useMemo(() => (active ? overallByKpi(active) : null), [active]);

  if (!active || !agg) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-sm text-muted-foreground">No data yet — <Link to="/" className="text-primary underline">upload a file</Link>.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Click any KPI card to see its 6-week trend.</p>
      <div className="mt-6">
        <KpiGrid data={agg} onSelect={(k) => navigate({ to: "/trend", search: { kpi: k.code } })} />
      </div>

      <section className="mt-10 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">All KPIs at a Glance</h2>
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>KPI</TableHead>
                <TableHead>What it measures</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead className="text-right">Breaches</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KPIS.map((k) => {
                const a = agg[k.code];
                const status = statusFor(k, a.rate);
                const label = LOWER_IS_BETTER.has(k.code) ? "BREACH RATE" : "COMPLIANCE";
                const variant = status === "good" ? "default" : status === "watch" ? "secondary" : "destructive";
                return (
                  <TableRow key={k.code}>
                    <TableCell className="font-medium">{k.code}</TableCell>
                    <TableCell className="text-muted-foreground">{k.measures}</TableCell>
                    <TableCell className="text-muted-foreground">{k.targetText}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.tickets.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.breaches.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{a.tickets === 0 ? "—" : formatRate(k.code, a.rate)}</TableCell>
                    <TableCell>
                      <Badge variant={variant as any} className="uppercase tracking-wide">
                        {status === "good" ? `On target · ${label}` : status === "watch" ? "Watch" : "Risk"}
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
