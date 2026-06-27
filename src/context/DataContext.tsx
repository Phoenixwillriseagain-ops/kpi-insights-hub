import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { ParsedWorkbook } from "@/lib/parseWorkbook";

type DataState = {
  workbook: ParsedWorkbook | null;
  setWorkbook: (wb: ParsedWorkbook | null) => void;
  clear: () => void;
};

const Ctx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [workbook, setWorkbookState] = useState<ParsedWorkbook | null>(null);
  const value = useMemo<DataState>(
    () => ({
      workbook,
      setWorkbook: (wb) => setWorkbookState(wb),
      clear: () => setWorkbookState(null),
    }),
    [workbook],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useData must be used within DataProvider");
  return v;
}
