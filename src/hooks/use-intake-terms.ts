import { useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * Shop intake terms, scoped for intake roles: /settings/shop requires
 * settings:view which FRONT_DESK/TECHNICIAN lack, so the signed ficha must
 * not depend on the full settings payload.
 *
 * Cache states: `undefined` = not loaded (or the fetch failed — retried on
 * the next intake); `null` = loaded and the shop uses the app default;
 * a string is the shop's custom clauses.
 */
let cached: string | null | undefined;
let inFlight: Promise<void> | null = null;

function loadIntakeTerms(): Promise<void> {
  if (!inFlight) {
    inFlight = api
      .get("/settings/intake-terms")
      .then((res) => {
        cached =
          typeof res.data?.intakeTerms === "string"
            ? res.data.intakeTerms
            : null;
      })
      .catch(() => {
        // Leave `cached` undefined so the next intake retries instead of
        // treating a failed load as an intentionally empty setting.
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Terms for the next intake — cached unless a settings save invalidated it. */
export async function fetchIntakeTerms(): Promise<string | null> {
  if (cached === undefined) {
    await loadIntakeTerms();
  }
  return cached ?? null;
}

/** Call after saving shop settings so the next intake picks up new clauses. */
export function invalidateIntakeTermsCache(): void {
  cached = undefined;
}

/**
 * Terms resolved ONCE per intake (`active` = intake modal open). The same
 * value feeds the displayed clauses, the remote-sign document and the
 * in-person submit — `undefined` while loading, so consumers must not
 * enable signing until it resolves.
 */
export function useIntakeTermsSession(
  active: boolean
): string | null | undefined {
  const [terms, setTerms] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      setTerms(undefined);
      return;
    }
    let cancelled = false;
    fetchIntakeTerms().then((value) => {
      if (!cancelled) {
        setTerms(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return terms;
}
