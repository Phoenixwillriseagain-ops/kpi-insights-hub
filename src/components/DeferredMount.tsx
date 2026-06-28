import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders `fallback` first, then mounts `children` on the next animation
 * frame followed by a microtask gap. The pending mount is cancelled if the
 * component unmounts before activation (e.g. tab switch) so we never call
 * `setState` on an unmounted node and never leave stale timers behind.
 */
export function DeferredMount({
  children,
  fallback,
  height = 240,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  height?: number;
}) {
  const [ready, setReady] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let raf = 0;
    let t = 0;
    raf = requestAnimationFrame(() => {
      t = window.setTimeout(() => {
        if (aliveRef.current) setReady(true);
      }, 16);
    });
    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);

  if (ready) return <>{children}</>;
  return (
    <>{fallback ?? <div style={{ height }} className="w-full animate-pulse rounded bg-secondary/30" />}</>
  );
}
