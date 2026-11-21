import { useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * Shop intake terms, scoped for intake roles: /settings/shop requires
 * settings:view which FRONT_DESK/TECHNICIAN lack, so the signed ficha must
 * not depend on the full settings payload.
 *
 * `undefined` = not loaded yet (or the fetch failed — retried on next
 * mount); `null` = loaded and the shop uses the app default; a string is
 * the shop's custom clauses.
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
        // Leave `cached` undefined so the next mount retries instead of
        // treating a failed load as an intentionally empty setting.
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Call after saving shop settings so intakes pick up new clauses. */
export function invalidateIntakeTermsCache(): void {
  cached = undefined;
}

export function useIntakeTerms(): string | null | undefined {
  const [terms, setTerms] = useState<string | null | undefined>(cached);

  useEffect(() => {
    if (cached !== undefined) {
      setTerms(cached);
      return;
    }
    loadIntakeTerms().then(() => setTerms(cached));
  }, []);

  return terms;
}
