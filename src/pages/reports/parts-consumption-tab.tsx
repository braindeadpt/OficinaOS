import type { PartConsumptionRow } from "@shared/types/reports";
import { useTranslation } from "react-i18next";
import { MetricCard } from "@/components/ui/metric-card";
import { downloadCsv } from "@/lib/export-csv";
import { useReportsStore } from "@/stores/reports";

function TrendBadge({ value }: { value: number | undefined }) {
  const { t } = useTranslation();
  if (value === undefined) {
    return (
      <span className="text-on-surface-variant/60">{t("reports.noTrend")}</span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-bold text-xs ${
        up
          ? "bg-error-container text-on-error-container"
          : "bg-primary-container text-on-primary-container"
      }`}
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[14px]"
      >
        {up ? "trending_up" : "trending_down"}
      </span>
      {up ? "+" : ""}
      {value}%
    </span>
  );
}

export default function PartsConsumptionTab() {
  const { t } = useTranslation();
  const state = useReportsStore((s) => s.partsConsumption);

  if (state.loading) {
    return (
      <div className="py-12 text-center text-on-surface-variant">
        {t("loading")}
      </div>
    );
  }

  if (state.error) {
    return <div className="py-12 text-center text-error">{state.error}</div>;
  }

  if (!state.data) {
    return (
      <div className="py-12 text-center text-on-surface-variant">
        {t("reports.noData")}
      </div>
    );
  }

  const { summary, topParts, includePosSales } = state.data;

  const exportCsv = () =>
    downloadCsv(
      `parts-consumption-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        t("reports.partName"),
        t("reports.category"),
        t("reports.qtyUsed"),
        t("reports.usageLines"),
        t("reports.avgUnitCost"),
        t("reports.totalCost"),
      ],
      topParts.map((r) => [
        r.partName,
        r.category ? t(`part_category.${r.category}`) : "",
        r.quantity,
        r.usageCount,
        r.avgUnitCost,
        r.totalCost,
      ])
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface-container-high px-4 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-highest disabled:opacity-50"
          disabled={topParts.length === 0}
          onClick={exportCsv}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">
            download
          </span>
          {t("reports.export_csv")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <MetricCard
          detail=""
          icon="inventory_2"
          label={t("reports.partsConsumed")}
          value={String(summary.totalQuantity)}
        />
        <MetricCard
          detail=""
          icon="category"
          label={t("reports.distinctParts")}
          value={String(summary.distinctParts)}
        />
        <MetricCard
          detail=""
          icon="payments"
          label={t("reports.partsCost")}
          value={summary.totalCost.toLocaleString()}
        />
      </div>

      <p className="text-on-surface-variant text-xs">
        {includePosSales
          ? t("reports.partsConsumptionScopeAll")
          : t("reports.partsConsumptionScopeJobs")}
      </p>

      <div>
        <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
          {t("reports.topParts")}
        </h2>
        {topParts.length === 0 ? (
          <div className="rounded-xl bg-surface-container-low px-4 py-8 text-center text-on-surface-variant text-sm">
            {t("reports.partsConsumptionEmpty")}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface-container-low">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">{t("reports.partName")}</th>
                  <th className="px-4 py-3">{t("reports.category")}</th>
                  <th className="px-4 py-3 text-end">{t("reports.qtyUsed")}</th>
                  <th className="px-4 py-3 text-end">{t("reports.trend")}</th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.usageLines")}
                  </th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.avgUnitCost")}
                  </th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.totalCost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {topParts.map((row: PartConsumptionRow) => (
                  <tr
                    className="border-outline-variant/50 border-b last:border-0"
                    key={row.partName}
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {row.partName}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {row.category ? t(`part_category.${row.category}`) : "—"}
                    </td>
                    <td className="px-4 py-3 text-end font-bold tabular-nums">
                      {row.quantity}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <TrendBadge value={row.quantityChangePercent} />
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {row.usageCount}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {row.avgUnitCost.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {row.totalCost.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
