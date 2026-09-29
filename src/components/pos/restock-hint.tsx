import type { RestockSuggestion } from "@shared/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";

function hasConsumptionData(s: RestockSuggestion): boolean {
  return s.recentConsumedTotal > 0;
}

function HintBody({ suggestion }: { suggestion: RestockSuggestion | null }) {
  const { t } = useTranslation();

  if (suggestion === null) {
    return (
      <p className="mt-0.5 font-label text-on-surface-variant text-xs">
        {t("loading")}
      </p>
    );
  }

  if (hasConsumptionData(suggestion)) {
    return (
      <p className="mt-0.5 font-label text-on-surface-variant text-xs">
        {t("pos.restock_suggestion", {
          avg: suggestion.avgDailyConsumption.toLocaleString(),
          days: suggestion.windowDays,
          qty: suggestion.suggestedQuantity.toLocaleString(),
        })}
        {suggestion.daysOfStockLeft !== null &&
          t("pos.restock_days_left", {
            count: suggestion.daysOfStockLeft,
            days: suggestion.daysOfStockLeft,
          })}
      </p>
    );
  }

  return (
    <p className="mt-0.5 font-label text-on-surface-variant text-xs">
      {t("pos.restock_no_data")}
    </p>
  );
}

interface RestockHintProps {
  partId: string;
}

/**
 * Restock suggestion shown when a catalog card is sold out in the POS.
 * Loads lazily (one GET per sold-out card), best-effort: on error it
 * stays silent so the sold-out state keeps working without analytics.
 */
export default function RestockHint({ partId }: RestockHintProps) {
  const [suggestion, setSuggestion] = useState<RestockSuggestion | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSuggestion(null);
    setFailed(false);
    api
      .get(`/parts/${partId}/restock-suggestion`)
      .then((res) => {
        if (!cancelled) {
          setSuggestion(res.data as RestockSuggestion);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [partId]);

  if (failed) {
    return null;
  }

  return (
    <div
      className="mt-2 w-full rounded-lg bg-surface-container-highest/70 px-2.5 py-2 text-start"
      data-testid="restock-hint"
    >
      <p className="flex items-center gap-1 font-bold font-label text-primary text-xs uppercase tracking-wide">
        <span aria-hidden="true" className="material-symbols-outlined text-sm">
          trending_up
        </span>
        <HintTitle />
      </p>
      <HintBody suggestion={suggestion} />
    </div>
  );
}

function HintTitle() {
  const { t } = useTranslation();
  return t("pos.restock_title");
}
