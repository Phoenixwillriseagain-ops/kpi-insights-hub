import { Link, useRouterState } from "@tanstack/react-router";
import { useData } from "@/context/DataContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Upload" },
  { to: "/overview", label: "Overview" },
  { to: "/trend", label: "6-Week Trend" },
  { to: "/queues", label: "Per Queue / Market" },
];

export function AppHeader() {
  const { workbook, clear } = useData();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-3">
        <Link to="/" className="text-base font-semibold tracking-tight">
          KPI Dashboard
        </Link>
        <nav className="flex flex-wrap items-center gap-1">
          {nav.map((n) => {
            const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          {workbook && (
            <>
              <div className="hidden text-xs text-muted-foreground sm:block">
                <span className="font-medium text-foreground">{workbook.fileName}</span>
                {" · "}
                {workbook.records.length.toLocaleString()} rows · {workbook.kpisFound.length} KPIs · {workbook.weeks.length} weeks
              </div>
              <Button size="sm" variant="ghost" onClick={clear}>
                Re-upload
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
