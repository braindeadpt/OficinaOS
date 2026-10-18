import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
import { useReportsStore } from "@/stores/reports";

export default function InsightsTab() {
  const { t } = useTranslation();
  const state = useReportsStore((s) => s.insights);

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

  const { summary, topCustomers } = state.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          detail=""
          icon="people"
          label={t("reports.totalCustomers")}
          value={String(summary.totalCustomers)}
        >
          <span className="flex gap-2">
            <Badge size="sm" variant="success">
              {t("reports.newCustomers", { count: summary.newCustomers })}
            </Badge>
            <Badge size="sm" variant="secondary">
              {t("reports.returningCustomers", {
                count: summary.returningCustomers,
              })}
            </Badge>
          </span>
        </MetricCard>
        <MetricCard
          detail=""
          icon="repeat"
          label={t("reports.repeatRate")}
          unit="%"
          value={String(summary.repeatRate)}
        />
        <MetricCard
          detail=""
          icon="payments"
          label={t("reports.avgSpendPerVisit")}
          value={summary.avgSpendPerVisit.toLocaleString()}
        />
        <MetricCard
          detail=""
          icon="receipt_long"
          label={t("reports.totalJobs")}
          value={String(summary.totalJobs)}
        />
      </div>

      {topCustomers.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.topCustomers")}
          </h2>
          <div className="overflow-x-auto rounded-xl bg-surface-container-low">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">{t("reports.customerName")}</th>
                  <th className="px-4 py-3">{t("reports.phone")}</th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.totalJobs")}
                  </th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.totalRevenue")}
                  </th>
                  <th className="px-4 py-3">{t("reports.lastVisit")}</th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.avgSpend")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c) => (
                  <tr
                    className="border-outline-variant/50 border-b last:border-0"
                    key={c.customerId}
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {c.customerName}
                    </td>
                    <td className="px-4 py-3 font-mono text-on-surface-variant">
                      {c.phone}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {c.totalJobs}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {c.totalRevenue.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {c.lastVisit
                        ? new Date(c.lastVisit).toLocaleDateString()
                        : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {c.avgSpend.toLocaleString()}
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
