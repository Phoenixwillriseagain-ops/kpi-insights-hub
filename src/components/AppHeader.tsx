import { Link, useRouterState } from "@tanstack/react-router";
import { useData } from "@/context/DataContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Upload" },
  { to: "/overview", label: "Overview" },
  { to: "/trend", label: "6-Week Trend" },
  { to: "/queues", label: "Per Queue / Market" },
];

export function AppHeader() {
  const { main, mainName, exclusion, exclusionName, view, setView, clear } = useData();
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
          {main && (
            <div className="hidden text-xs text-muted-foreground sm:block">
              <span className="font-medium text-foreground">Main:</span> {mainName} · {main.rows.length.toLocaleString()} rows
              {exclusion && (
                <>
                  <span className="mx-2">|</span>
                  <span className="font-medium text-foreground">Excl:</span> {exclusionName}
                </>
              )}
            </div>
          )}
          {exclusion && (
            <div className="flex items-center gap-2">
              <Label htmlFor="view-toggle" className="text-xs text-muted-foreground">
                Before
              </Label>
              <Switch
                id="view-toggle"
                checked={view === "after"}
                onCheckedChange={(c) => setView(c ? "after" : "before")}
              />
              <Label htmlFor="view-toggle" className="text-xs text-muted-foreground">
                After excl.
              </Label>
            </div>
          )}
          {(main || exclusion) && (
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
