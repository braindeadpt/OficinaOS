import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";

interface ForecastRow {
  avgDailyUsage: number;
  daysLeft: number | null;
  partId: string;
  partName: string;
  reorderLevel: number;
  stockQuantity: number;
  suggestedQuantity: number;
  supplier: string | null;
}

interface ForecastPayload {
  rows: ForecastRow[];
  summary: { partsAtRisk: number; totalSuggestedQuantity: number };
  windowDays: number;
}

function daysLeftTone(daysLeft: number | null): string {
  if (daysLeft === null) {
    return "text-on-surface-variant";
  }
  if (daysLeft <= 7) {
    return "text-error";
  }
  if (daysLeft <= 14) {
    return "text-warning";
  }
  return "text-primary";
}

export default function RestockForecastDialog({
  onClose,
  onBuySuggestion,
}: {
  onClose: () => void;
  onBuySuggestion: (partId: string) => void;
}) {
  const { t } = useTranslation();
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchForecast = useCallback(async () => {
    try {
      const res = await api.get("/parts/restock-forecast");
      setForecast(res.data as ForecastPayload);
    } catch {
      // Empty state below covers the failure.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
        type="button"
      />
      <div className="modal-surface relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-outline-variant border-b px-6 py-4">
          <div>
            <h2 className="font-bold font-headline text-lg text-on-surface">
              {t("parts_restock_forecast")}
            </h2>
            {forecast && (
              <p className="font-label text-on-surface-variant text-xs">
                {t("parts_forecast_window", { days: forecast.windowDays })}
              </p>
            )}
          </div>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {forecast && (
          <div className="grid grid-cols-2 gap-3 border-outline-variant border-b px-6 py-4">
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="font-label text-on-surface-variant text-xs uppercase">
                {t("parts_forecast_parts_at_risk")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-2xl text-on-surface">
                {forecast.summary.partsAtRisk}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="font-label text-on-surface-variant text-xs uppercase">
                {t("parts_forecast_total_units")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-2xl text-primary">
                {forecast.summary.totalSuggestedQuantity}
              </p>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <span className="material-symbols-outlined animate-spin text-on-surface-variant">
                progress_activity
              </span>
            </div>
          )}

          {!isLoading && (!forecast || forecast.rows.length === 0) && (
            <p className="py-8 text-center text-on-surface-variant text-sm">
              {t("parts_forecast_empty")}
            </p>
          )}

          {forecast && forecast.rows.length > 0 && (
            <ul className="space-y-2">
              {forecast.rows.map((row) => (
                <li
                  className="flex items-center gap-3 rounded-xl bg-surface-container-low p-3"
                  key={row.partId}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold font-headline text-on-surface text-sm">
                      {row.partName}
                    </p>
                    <p className="font-label text-on-surface-variant text-xs">
                      {t("parts_forecast_daily")}: {row.avgDailyUsage} ·{" "}
                      {t("pos.stock_label")}: {row.stockQuantity}
                      {row.supplier ? ` · ${row.supplier}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p
                      className={`font-bold font-mono text-sm ${daysLeftTone(row.daysLeft)}`}
                    >
                      {row.daysLeft === null
                        ? t("parts_forecast_no_usage")
                        : t("parts_forecast_days_left", {
                            days: row.daysLeft,
                          })}
                    </p>
                    <p className="font-label text-on-surface-variant text-xs">
                      {t("parts_forecast_suggested")}:{" "}
                      <span className="font-bold text-primary">
                        {row.suggestedQuantity}
                      </span>
                    </p>
                  </div>
                  <button
                    aria-label={t("parts_forecast_buy")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container transition-colors hover:opacity-90"
                    onClick={() => onBuySuggestion(row.partId)}
                    title={t("parts_forecast_buy")}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[18px]"
                    >
                      shopping_cart
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
