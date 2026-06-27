import { useEffect, useState, type ReactNode } from "react";

/**
 * Renders `fallback` synchronously, then mounts `children` on the next
 * animation frame. Lets heavy chart subtrees swap in without blocking
 * the click/tab-change handler that triggered the mount.
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
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);
  if (ready) return <>{children}</>;
  return (
    <>{fallback ?? <div style={{ height }} className="w-full animate-pulse rounded bg-secondary/30" />}</>
  );
}
