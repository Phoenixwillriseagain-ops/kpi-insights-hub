import { useEffect, useRef, useState, type ReactNode } from "react";

// Global mount queue — serialises DeferredMount activations across the whole
// component tree with a deliberate gap between each mount so the browser
// always has time to process user input between frames.
const queue: Array<() => void> = [];
let draining = false;

function enqueue(activate: () => void) {
  queue.push(activate);
  if (!draining) drain();
}

function drain() {
  if (queue.length === 0) { draining = false; return; }
  const next = queue.shift()!;
  if (next) next();
  setTimeout(drain, 50);
}

/**
 * Renders `fallback` synchronously, then queues `children` to mount
 * one-at-a-time with a 50 ms gap between each activation.
 * This prevents the render avalanche that occurs when many panels mount
 * simultaneously after a dataset is loaded, while keeping the UI interactive
 * throughout the stagger sequence.
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
    // Flush any remaining queued items when this instance unmounts
    // (e.g. tab switch before all panels have loaded).
    return () => {
      mounted.current = false;
    };
  }, []);

  if (ready) return <>{children}</>;
  return (
    <>{fallback ?? <div style={{ height }} className="w-full animate-pulse rounded bg-secondary/30" />}</>
  );
}
