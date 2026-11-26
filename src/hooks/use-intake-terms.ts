import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/lib/api";

/**
 * Shop intake terms, scoped for intake roles: /settings/shop requires
 * settings:view which FRONT_DESK/TECHNICIAN lack, so the signed ficha must
 * not depend on the full settings payload.
 *
 * No cross-intake cache and no shared in-flight request: clauses can be
 * edited on another workstation at any time, so every intake opening
 * queries the server and the result is frozen only for that intake.
 */
function loadIntakeTerms(): Promise<{ terms: string | null; version: number }> {
  return api.get("/settings/intake-terms").then((res) => ({
    terms:
      typeof res.data?.intakeTerms === "string" ? res.data.intakeTerms : null,
    version:
      typeof res.data?.intakeTermsVersion === "number"
        ? res.data.intakeTermsVersion
        : 1,
  }));
}

/** Fresh terms for the next intake — always queries the server. */
export function fetchIntakeTerms(): Promise<{
  terms: string | null;
  version: number;
}> {
  return loadIntakeTerms();
}

export interface IntakeTermsSession {
  /**
   * True when the fetch failed. Terms stays `undefined` so signing remains
   * disabled — a failed load must never fall back to the default clauses.
   */
  failed: boolean;
  /** Re-run the fetch after a failure. */
  retry: () => void;
  /**
   * `undefined` while loading; `null` = loaded and the shop uses the app
   * default; a string is the shop's custom clauses.
   */
  terms: string | null | undefined;
  version: number | undefined;
}

/**
 * Terms resolved ONCE per intake (`active` = intake modal open). The same
 * value feeds the displayed clauses, the remote-sign document and the
 * in-person submit — `undefined` while loading, so consumers must not
 * enable signing until it resolves.
 */
export function useIntakeTermsSession(active: boolean): IntakeTermsSession {
  const [state, setState] = useState<{
    failed: boolean;
    terms: string | null | undefined;
    version: number | undefined;
  }>({ failed: false, terms: undefined, version: undefined });
  // Monotonic request id — a stale response (closed intake, superseded retry)
  // must never overwrite newer state.
  const requestSeq = useRef(0);

  const run = useCallback(() => {
    const seq = ++requestSeq.current;
    fetchIntakeTerms()
      .then((value) => {
        if (requestSeq.current === seq) {
          setState({
            failed: false,
            terms: value.terms,
            version: value.version,
          });
        }
      })
      .catch(() => {
        if (requestSeq.current === seq) {
          setState({ failed: true, terms: undefined, version: undefined });
        }
      });
  }, []);

  useEffect(() => {
    if (!active) {
      requestSeq.current += 1;
      setState({ failed: false, terms: undefined, version: undefined });
      return;
    }
    run();
  }, [active, run]);

  const retry = useCallback(() => {
    setState({ failed: false, terms: undefined, version: undefined });
    run();
  }, [run]);

  return {
    failed: state.failed,
    retry,
    terms: state.terms,
    version: state.version,
  };
}
