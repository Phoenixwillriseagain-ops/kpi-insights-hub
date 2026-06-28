import { useEffect, useRef, useState } from "react";
import { isPerfEnabled, perfSubscribe, installLongTaskObserver, type PerfEntry } from "@/lib/perf";

/**
 * Floating diagnostic panel. Only rendered when `?perf=1` is in the URL
 * or `localStorage.perf === "1"`. Shows live FPS, JS heap (when available),
 * and a rolling log of timed marks / long-task warnings.
 */
export function PerfPanel() {
  const [enabled] = useState(isPerfEnabled);
  const [entries, setEntries] = useState<PerfEntry[]>([]);
  const [fps, setFps] = useState(60);
  const [heap, setHeap] = useState<string>("");
  const [collapsed, setCollapsed] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    installLongTaskObserver();
    const unsub = perfSubscribe((b) => setEntries(b.slice(-40)));

    // FPS sampler — counts frames per 500 ms window.
    let frames = 0;
    let last = performance.now();
    const loop = (t: number) => {
      frames++;
      if (t - last >= 500) {
        setFps(Math.round((frames * 1000) / (t - last)));
        frames = 0;
        last = t;
        const mem = (performance as Performance & {
          memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
        }).memory;
        if (mem) {
          setHeap(`${(mem.usedJSHeapSize / 1048576).toFixed(0)}/${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB`);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      unsub();
    };
  }, [enabled]);

  if (!enabled) return null;

  const fpsColor = fps >= 50 ? "#22c55e" : fps >= 30 ? "#f59e0b" : "#ef4444";

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.35,
        background: "rgba(15,23,42,0.92)",
        color: "#e2e8f0",
        border: "1px solid rgba(148,163,184,0.3)",
        borderRadius: 8,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        width: collapsed ? 130 : 360,
        maxHeight: collapsed ? 38 : 320,
        overflow: "hidden",
      }}
      role="region"
      aria-label="Performance panel"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 10px",
          background: "transparent",
          color: "inherit",
          border: 0,
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <span>
          <span style={{ color: fpsColor, fontWeight: 700 }}>{fps} fps</span>
          {heap && <span style={{ marginLeft: 8, color: "#94a3b8" }}>{heap}</span>}
        </span>
        <span style={{ color: "#94a3b8" }}>{collapsed ? "▲ perf" : "▼ perf"}</span>
      </button>
      {!collapsed && (
        <div style={{ maxHeight: 270, overflowY: "auto", padding: "4px 10px 10px" }}>
          {entries.length === 0 && <div style={{ color: "#64748b" }}>no events yet…</div>}
          {entries.slice().reverse().map((e) => {
            const color =
              e.kind === "longtask" ? "#fca5a5" :
              e.kind === "measure" ? (e.duration && e.duration > 100 ? "#fbbf24" : "#86efac") :
              "#cbd5e1";
            return (
              <div key={e.id} style={{ color, display: "flex", gap: 6, padding: "1px 0" }}>
                <span style={{ color: "#64748b", flexShrink: 0, width: 52 }}>
                  {(e.ts / 1000).toFixed(2)}s
                </span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>
                  {e.label}
                  {e.duration != null && <span style={{ color: "#94a3b8" }}> · {e.duration.toFixed(1)}ms</span>}
                  {e.detail && <span style={{ color: "#64748b" }}> · {e.detail}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
