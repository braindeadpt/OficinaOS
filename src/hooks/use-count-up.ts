import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// jsdom never fires rAF callbacks — without this the value would stay at 0.
const IS_TEST_ENV =
  typeof import.meta.env !== "undefined" && import.meta.env.MODE === "test";

/**
 * Animates a number toward `target` with an ease-out curve.
 * Jumps straight to the target under prefers-reduced-motion.
 */
export function useCountUp(target: number, duration = 700): number {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    if (IS_TEST_ENV || from === target || prefersReducedMotion()) {
      setDisplay(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setDisplay(from + (target - from) * easeOutCubic(p));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}
