import { cn } from "@/lib/utils";
import { KPIS, LOWER_IS_BETTER, statusFor, type KpiDef } from "@/lib/kpiConfig";
import type { KpiAgg } from "@/lib/aggregate";

const styles = {
  good: "bg-emerald-50 border-emerald-200 text-emerald-900",
  watch: "bg-amber-50 border-amber-200 text-amber-900",
  risk: "bg-rose-50 border-rose-200 text-rose-900",
};

const valueColor = {
  good: "text-emerald-700",
  watch: "text-amber-700",
  risk: "text-rose-700",
};

export function formatRate(code: string, rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

export function KpiCard({ kpi, agg, onClick }: { kpi: KpiDef; agg: KpiAgg; onClick?: () => void }) {
  const isLower = LOWER_IS_BETTER.has(kpi.code);
  const displayed = isLower ? agg.rate : agg.rate; // already correct from aggregate
  const status = statusFor(kpi, displayed);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-2xl border p-4 text-left transition-shadow hover:shadow-md",
        styles[status],
      )}
    >
      <div className="text-xs font-medium opacity-70">{kpi.code}</div>
      <div className={cn("text-3xl font-semibold tabular-nums", valueColor[status])}>
        {agg.tickets === 0 ? "—" : formatRate(kpi.code, displayed)}
      </div>
      <div className="text-xs opacity-75">
        {agg.tickets.toLocaleString()} tickets · {agg.breaches.toLocaleString()} breaches
      </div>
      <div className="mt-2 text-xs leading-snug opacity-80">{kpi.measures}</div>
    </button>
  );
}

export function KpiGrid({ data, onSelect }: { data: Record<string, KpiAgg>; onSelect?: (k: KpiDef) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6">
      {KPIS.map((k) => (
        <KpiCard key={k.code} kpi={k} agg={data[k.code]} onClick={onSelect ? () => onSelect(k) : undefined} />
      ))}
    </div>
  );
}
