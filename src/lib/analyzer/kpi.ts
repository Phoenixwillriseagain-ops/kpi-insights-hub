// KPI metadata + RAG calculation, ported from combined-analyzer.html
export const KPI_ORDER = [
  "KSL-1","KSL-2a","KSL-2b","KSL-2c","KSL-2d",
  "KSL-3a","KSL-3b","KSL-4","KSL-5a","KSL-5b",
  "KSL-6","KM-1","KM-2",
] as const;

export type KpiCode = (typeof KPI_ORDER)[number];

export type KpiMeta = {
  code: KpiCode;
  what: string;
  isKM: boolean;
  isRating: boolean;
  target: number;
  targetLabel: string;
  color: string;
};

export const KPI_META: Record<KpiCode, KpiMeta> = {
  "KSL-1":  { code:"KSL-1",  what:"Dealer Satisfaction Rating L1",        isKM:false, isRating:true,  target:4,  targetLabel:"≥ 4.00",       color:"#005f73" },
  "KSL-2a": { code:"KSL-2a", what:"Handling Time Low ≤180min",            isKM:false, isRating:false, target:90, targetLabel:"≥ 90%",        color:"#0a9396" },
  "KSL-2b": { code:"KSL-2b", what:"Handling Time Low ≤300min",            isKM:false, isRating:false, target:95, targetLabel:"≥ 95%",        color:"#94d2bd" },
  "KSL-2c": { code:"KSL-2c", what:"Handling Time Medium ≤150min",         isKM:false, isRating:false, target:90, targetLabel:"≥ 90%",        color:"#e9d8a6" },
  "KSL-2d": { code:"KSL-2d", what:"Handling Time Medium ≤180min",         isKM:false, isRating:false, target:95, targetLabel:"≥ 95%",        color:"#ee9b00" },
  "KSL-3a": { code:"KSL-3a", what:"Reaction Time Ticket ≤30min",          isKM:false, isRating:false, target:95, targetLabel:"≥ 95%",        color:"#ca6702" },
  "KSL-3b": { code:"KSL-3b", what:"Reaction Time Chat ≤60sec",            isKM:false, isRating:false, target:95, targetLabel:"≥ 95%",        color:"#f4a261" },
  "KSL-4":  { code:"KSL-4",  what:"Solution Quality w/o Related Incident",isKM:false, isRating:false, target:70, targetLabel:"≥ 70%",        color:"#ae2012" },
  "KSL-5a": { code:"KSL-5a", what:"Process Conformity Automatic",         isKM:false, isRating:false, target:90, targetLabel:"≥ 90%",        color:"#9b2226" },
  "KSL-5b": { code:"KSL-5b", what:"Process Conformity Manual",            isKM:false, isRating:false, target:90, targetLabel:"≥ 90%",        color:"#7b2cbf" },
  "KSL-6":  { code:"KSL-6",  what:"Linking to Compass",                   isKM:false, isRating:false, target:95, targetLabel:"≥ 95%",        color:"#3a86ff" },
  "KM-1":   { code:"KM-1",   what:"With Reopen",                          isKM:true,  isRating:false, target:5,  targetLabel:"≤ 5%",         color:"#d00000" },
  "KM-2":   { code:"KM-2",   what:"With Assigned Back",                   isKM:true,  isRating:false, target:5,  targetLabel:"≤ 5%",         color:"#9d0208" },
};

export type Rag = "green" | "amber" | "red" | "none";

export type RagResult = {
  display: string;
  rag: Rag;
  value: number;
  rate: number; // numeric percentage (or rating)
};

export function calcTarget(total: number, breaches: number, meta: KpiMeta): RagResult {
  if (!total) return { display: "—", rag: "none", value: 0, rate: 0 };
  const rate = meta.isKM ? (breaches / total) * 100 : ((total - breaches) / total) * 100;
  const t = meta.target;
  let rag: Rag;
  if (meta.isKM) rag = rate <= t ? "green" : rate <= t * 1.5 ? "amber" : "red";
  else rag = rate >= t ? "green" : rate >= t - 5 ? "amber" : "red";
  return { display: rate.toFixed(1) + "%", rag, value: rate, rate };
}

export function ragLabel(rag: Rag, isKM: boolean): string {
  if (isKM) return rag === "green" ? "PASS" : rag === "amber" ? "WATCH" : rag === "red" ? "FAIL" : "—";
  return rag === "green" ? "ON TARGET" : rag === "amber" ? "WATCH" : rag === "red" ? "BELOW TARGET" : "—";
}

export function ragColor(rag: Rag): string {
  return rag === "green" ? "var(--success)" : rag === "amber" ? "var(--warning)" : rag === "red" ? "var(--danger)" : "var(--muted-foreground)";
}

const norm = (s: unknown) => String(s ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

export function matchKpi(rawName: unknown): KpiCode | null {
  const name = String(rawName ?? "").trim();
  if (!name) return null;
  if ((KPI_META as Record<string, KpiMeta>)[name]) return name as KpiCode;
  const lower = name.toLowerCase();
  let found = KPI_ORDER.find((k) => k.toLowerCase() === lower);
  if (found) return found;
  const nn = norm(name);
  found = KPI_ORDER.find((k) => norm(k) === nn);
  if (found) return found;
  found = KPI_ORDER.find((k) => nn.indexOf(norm(k)) === 0);
  if (found) return found;
  found = KPI_ORDER.find((k) => nn.indexOf(norm(k)) !== -1);
  return found ?? null;
}
