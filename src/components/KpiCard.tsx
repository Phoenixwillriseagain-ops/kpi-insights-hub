import { cn } from "@/lib/utils";
import { KPIS, statusFor, formatPct, isLowerBetter, type KpiDef } from "@/lib/kpiConfig";
import type { BeforeAfter } from "@/lib/aggregate";

const styles = {
  good: "bg-emerald-50 border-emerald-200 text-emerald-950",
  watch: "bg-amber-50 border-amber-200 text-amber-950",
  risk: "bg-rose-50 border-rose-200 text-rose-950",
};

const valueColor = {
  good: "text-emerald-700",
  watch: "text-amber-700",
  risk: "text-rose-700",
};

export function KpiCard({ kpi, ba, onClick }: { kpi: KpiDef; ba: BeforeAfter; onClick?: () => void }) {
  const status = statusFor(kpi, ba.after.pct);
  const delta = (ba.after.pct - ba.before.pct) * 100;
  const lower = isLowerBetter(kpi);
  const deltaGood = lower ? delta <= 0 : delta >= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border p-4 text-left transition-shadow hover:shadow-md",
        styles[status],
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide">{kpi.code}</span>
        <span className="text-[10px] uppercase opacity-70">{kpi.targetText}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">Before</div>
          <div className="text-xl font-semibold tabular-nums opacity-80">
            {ba.before.total === 0 ? "—" : formatPct(ba.before.pct)}
          </div>
          <div className="text-[10px] opacity-60 tabular-nums">{ba.before.breach}/{ba.before.total}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide opacity-60">After</div>
          <div className={cn("text-xl font-semibold tabular-nums", valueColor[status])}>
            {ba.after.total === 0 ? "—" : formatPct(ba.after.pct)}
          </div>
          <div className="text-[10px] opacity-60 tabular-nums">{ba.after.breach}/{ba.after.total}</div>
        </div>
      </div>

      {ba.before.total > 0 && ba.after.total > 0 && (
        <div className={cn("text-[10px] font-medium", deltaGood ? "text-emerald-700" : "text-rose-700")}>
          Δ {delta >= 0 ? "+" : ""}{delta.toFixed(1)} pts
        </div>
      )}

      <div className="mt-1 text-xs leading-snug opacity-75 line-clamp-2">{kpi.label}</div>
    </button>
  );
}

export function KpiGrid({ data, onSelect }: { data: Record<string, BeforeAfter>; onSelect?: (k: KpiDef) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {KPIS.map((k) => (
        <KpiCard key={k.code} kpi={k} ba={data[k.code]} onClick={onSelect ? () => onSelect(k) : undefined} />
      ))}
    </div>
  );
}
