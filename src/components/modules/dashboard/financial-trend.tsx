import { useTranslation } from "react-i18next";

interface FinancialTrendPoint {
  cost: number;
  date: string;
  revenue: number;
}

interface FinancialTrendProps {
  data: FinancialTrendPoint[];
}

export default function FinancialTrend({ data }: FinancialTrendProps) {
  const { t, i18n } = useTranslation();

  const allZero =
    data.length === 0 || data.every((d) => d.revenue === 0 && d.cost === 0);

  const maxVal = allZero
    ? 1
    : Math.max(...data.flatMap((d) => [d.revenue, d.cost]), 1);

  const LOCALES: Record<string, string> = {
    en: "en-US",
    es: "es-ES",
    fr: "fr-FR",
  };
  const DEFAULT_LOCALE = "pt-PT";

  const formatDay = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00`);
    const locale = LOCALES[i18n.language] ?? DEFAULT_LOCALE;
    return d.toLocaleDateString(locale, { weekday: "short" });
  };

  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container-low p-6">
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <h3 className="font-bold font-headline text-lg text-on-surface">
          {t("revenue_this_week")}
        </h3>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <span className="font-bold text-on-surface-variant text-xs uppercase">
              {t("revenue")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-on-surface-variant/60" />
            <span className="font-bold text-on-surface-variant text-xs uppercase">
              {t("cost")}
            </span>
          </div>
        </div>
      </div>

      {allZero ? (
        <div className="flex h-48 flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined mb-2 text-3xl text-surface-variant">
            bar_chart
          </span>
          <p className="text-on-surface-variant text-sm">
            {t("financial_trend_empty")}
          </p>
        </div>
      ) : (
        <div className="flex h-48 items-end gap-1 px-2 sm:gap-2">
          {data.map((day) => (
            <div
              className="flex flex-1 flex-col justify-end gap-1"
              key={day.date}
            >
              <div
                className="w-full rounded-t bg-outline-variant/40 transition-all duration-500"
                style={{ height: `${(day.cost / maxVal) * 100}%` }}
              />
              <div
                className="w-full rounded-t bg-primary transition-all duration-500"
                style={{ height: `${(day.revenue / maxVal) * 100}%` }}
              />
              <span className="mt-2 text-center font-bold text-[8px] text-on-surface-variant uppercase sm:text-[9px]">
                {formatDay(day.date)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
