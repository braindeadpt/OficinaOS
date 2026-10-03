import { useTranslation } from "react-i18next";
import { MetricCard } from "@/components/ui/metric-card";
import { downloadCsv } from "@/lib/export-csv";
import { useReportsStore } from "@/stores/reports";

export default function OperationsTab() {
  const { t } = useTranslation();
  const state = useReportsStore((s) => s.operations);

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

  const { summary, topRepairs, statusBreakdown } = state.data;

  const exportCsv = () =>
    downloadCsv(
      `operations-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        t("reports.repairName"),
        t("reports.category"),
        t("reports.count"),
        t("reports.avgPrice"),
        t("reports.revenue"),
      ],
      topRepairs.map((r) => [
        r.repairName,
        r.category,
        r.count,
        r.avgPrice,
        r.revenue,
      ])
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface-container-high px-4 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-highest disabled:opacity-50"
          disabled={topRepairs.length === 0}
          onClick={exportCsv}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">
            download
          </span>
          {t("reports.export_csv")}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          detail={
            summary.jobsCompletedChangePercent === undefined
              ? ""
              : `${summary.jobsCompletedChangePercent > 0 ? "+" : ""}${summary.jobsCompletedChangePercent}%`
          }
          icon="check_circle"
          label={t("reports.jobsCompleted")}
          value={String(summary.jobsCompleted)}
        />
        <MetricCard
          detail={t("reports.hours")}
          icon="schedule"
          label={t("reports.avgTurnaround")}
          value={String(summary.avgTurnaroundHours)}
        />
        <MetricCard
          detail=""
          icon="engineering"
          label={t("reports.jobsInProgress")}
          value={String(summary.jobsInProgress)}
        />
        {summary.warrantyReturnRate !== undefined && (
          <MetricCard
            detail="%"
            icon="autorenew"
            label={t("reports.warrantyReturnRate")}
            value={`${summary.warrantyReturnRate}%`}
          />
        )}
      </div>

      {topRepairs.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.topRepairs")}
          </h2>
          <div className="overflow-x-auto rounded-xl bg-surface-container-low">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">{t("reports.repairName")}</th>
                  <th className="px-4 py-3">{t("reports.category")}</th>
                  <th className="px-4 py-3 text-end">{t("reports.count")}</th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.avgPrice")}
                  </th>
                  <th className="px-4 py-3 text-end">{t("reports.revenue")}</th>
                </tr>
              </thead>
              <tbody>
                {topRepairs.map((r) => (
                  <tr
                    className="border-outline-variant/50 border-b last:border-0"
                    key={`${r.repairName}-${r.category}`}
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {r.repairName}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {r.category}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {r.count}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {r.avgPrice.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {r.revenue.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {statusBreakdown.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.statusBreakdown")}
          </h2>
          <div className="overflow-x-auto rounded-xl bg-surface-container-low">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">{t("reports.status")}</th>
                  <th className="px-4 py-3 text-end">{t("reports.count")}</th>
                  <th className="px-4 py-3 text-end">{t("reports.avgDays")}</th>
                </tr>
              </thead>
              <tbody>
                {statusBreakdown.map((s) => (
                  <tr
                    className="border-outline-variant/50 border-b last:border-0"
                    key={s.status}
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {t(`jobStatus.${s.status}`)}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {s.count}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {s.avgDays}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
