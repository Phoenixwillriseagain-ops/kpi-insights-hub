import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ParsedWorkbook } from "@/lib/parseWorkbook";

type DataState = {
  main: ParsedWorkbook | null;
  mainName: string | null;
  exclusion: ParsedWorkbook | null;
  exclusionName: string | null;
  view: "before" | "after";
  setMain: (wb: ParsedWorkbook | null, name?: string | null) => void;
  setExclusion: (wb: ParsedWorkbook | null, name?: string | null) => void;
  setView: (v: "before" | "after") => void;
  active: ParsedWorkbook | null;
  clear: () => void;
};

const Ctx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [main, setMainState] = useState<ParsedWorkbook | null>(null);
  const [mainName, setMainName] = useState<string | null>(null);
  const [exclusion, setExclusionState] = useState<ParsedWorkbook | null>(null);
  const [exclusionName, setExclusionName] = useState<string | null>(null);
  const [view, setView] = useState<"before" | "after">("before");

  const value = useMemo<DataState>(() => {
    const active = view === "after" && exclusion ? exclusion : main;
    return {
      main,
      mainName,
      exclusion,
      exclusionName,
      view,
      setMain: (wb, name) => { setMainState(wb); setMainName(name ?? null); },
      setExclusion: (wb, name) => { setExclusionState(wb); setExclusionName(name ?? null); },
      setView,
      active,
      clear: () => {
        setMainState(null); setMainName(null);
        setExclusionState(null); setExclusionName(null);
        setView("before");
      },
    };
  }, [main, mainName, exclusion, exclusionName, view]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used within DataProvider");
  return v;
}
