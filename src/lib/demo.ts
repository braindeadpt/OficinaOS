import { useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * Public demo flag — one fetch of GET /api/demo/status per page load,
 * cached module-wide. Outside DEMO_MODE the endpoint still answers
 * {demo:false}, so the hook is safe on normal installs.
 */
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function fetchDemoMode(): Promise<boolean> {
  if (cached !== null) {
    return Promise.resolve(cached);
  }
  inflight ??= api
    .get<{ demo: boolean }>("/demo/status")
    .then((res) => Boolean(res.data?.demo))
    .catch(() => false)
    .then((demo) => {
      cached = demo;
      inflight = null;
      return demo;
    });
  return inflight;
}

export function useDemoMode(): boolean {
  const [demo, setDemo] = useState(cached ?? false);
  useEffect(() => {
    let cancelled = false;
    fetchDemoMode().then((v) => {
      if (!cancelled) {
        setDemo(v);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return demo;
}
