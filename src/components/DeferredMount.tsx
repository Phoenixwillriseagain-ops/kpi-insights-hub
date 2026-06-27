import { useEffect, useRef, useState, type ReactNode } from "react";

// Global mount queue — serialises DeferredMount activations across the whole
// component tree so they never all fire in the same frame.
const queue: Array<() => void> = [];
let draining = false;

function enqueue(activate: () => void) {
  queue.push(activate);
  if (!draining) drain();
}

function drain() {
  if (queue.length === 0) { draining = false; return; }
  draining = true;
  // One mount per animation frame keeps every frame under ~16 ms.
  requestAnimationFrame(() => {
    const next = queue.shift();
    if (next) next();
    drain();
  });
}

/**
 * Renders `fallback` synchronously, then queues `children` to mount
 * one-per-frame via a global serialised RAF queue.
 * This prevents the render avalanche that occurs when many panels mount
 * simultaneously after a dataset is loaded.
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
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    enqueue(() => {
      setReady(true);
    });
  }, []);

  if (ready) return <>{children}</>;
  return (
    <>{fallback ?? <div style={{ height }} className="w-full animate-pulse rounded bg-secondary/30" />}</>
  );
}
