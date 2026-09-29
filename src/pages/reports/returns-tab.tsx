import type { TtrBucket } from "@shared/types/reports";
import { useTranslation } from "react-i18next";
import { Histogram } from "@/components/ui/histogram";
import { MetricCard } from "@/components/ui/metric-card";
import { StackedBar } from "@/components/ui/stacked-bar";
import { useCan } from "@/hooks/use-can";
import { FAULT_TONES } from "@/lib/category-display";
import { useReportsStore } from "@/stores/reports";

const TTR_BUCKET_LABELS: Record<TtrBucket, string> = {
  "0-7d": "reports.ttr_0_7d",
  "8-30d": "reports.ttr_8_30d",
  "31-60d": "reports.ttr_31_60d",
  "61-90d": "reports.ttr_61_90d",
  "90d+": "reports.ttr_90d_plus",
};

function changeDetail(pct: number | undefined): string {
  if (pct === undefined) {
    return "";
  }
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export default function ReturnsTab() {
  const { t } = useTranslation();
  const state = useReportsStore((s) => s.returns);
  const canViewShop = useCan({ returns: ["viewShop"] });

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

  const {
    summary,
    byFaultCategory,
    byRepairType,
    byTechnician,
    ttrDistribution,
  } = state.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          detail={changeDetail(summary.totalReturnsChangePercent)}
          icon="cached"
          label={t("reports.totalReturns")}
          value={String(summary.totalReturns)}
        />
        {summary.warrantyReturnRate !== undefined && (
          <MetricCard
            detail={changeDetail(summary.warrantyReturnRateChangePercent)}
            icon="autorenew"
            label={t("reports.warrantyReturnRate")}
            value={`${summary.warrantyReturnRate}%`}
          />
        )}
        {summary.netWarrantyCost !== undefined && (
          <MetricCard
            detail={changeDetail(summary.netWarrantyCostChangePercent)}
            icon="payments"
            label={t("reports.netWarrantyCost")}
            value={summary.netWarrantyCost.toLocaleString()}
          >
            <p className="text-on-surface-variant text-xs">
              {t("reports.warrantyCostFootnote")}
            </p>
          </MetricCard>
        )}
        <MetricCard
          detail={changeDetail(summary.avgTimeToReturnChangePercent)}
          icon="schedule"
          label={t("reports.avgTimeToReturn")}
          unit={t("reports.days")}
          value={String(summary.avgTimeToReturnDays)}
        />
      </div>

      {byFaultCategory.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.faultCategory")}
          </h2>
          <div className="space-y-2">
            {byFaultCategory.map((fc) => (
              <div
                className="flex items-center gap-3 rounded-lg bg-surface-container-low px-4 py-2"
                key={fc.faultCategory}
              >
                <span
                  className={`inline-block size-3 rounded-full ${FAULT_TONES[fc.faultCategory]}`}
                />
                <span className="flex-1 font-medium text-on-surface text-sm">
                  {fc.faultCategory}
                </span>
                <span className="text-on-surface-variant text-sm tabular-nums">
                  {fc.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {byRepairType.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.byRepairType")}
          </h2>
          <div className="rounded-xl bg-surface-container-low p-4">
            <StackedBar
              rows={byRepairType.map((r) => ({
                label: r.repairName,
                total: r.count,
                segments: r.faults.map((f) => ({
                  label: f.faultCategory,
                  value: f.count,
                  color: FAULT_TONES[f.faultCategory],
                })),
              }))}
            />
          </div>
        </div>
      )}

      {canViewShop && byTechnician.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.byTechnician")}
          </h2>
          <div className="overflow-x-auto rounded-xl bg-surface-container-low">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                  <th className="px-4 py-3">{t("reports.technician")}</th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.jobsDelivered")}
                  </th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.claimsCount")}
                  </th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.returnRate")}
                  </th>
                  <th className="px-4 py-3 text-end">
                    {t("reports.dominantFault")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {byTechnician.map((tech) => (
                  <tr
                    className="border-outline-variant/50 border-b last:border-0"
                    key={tech.technicianId}
                  >
                    <td className="px-4 py-3 font-medium text-on-surface">
                      {tech.technicianName}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {tech.jobsDelivered}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {tech.claimsCount}
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">
                      {tech.returnRate}%
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {tech.dominantFault}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ttrDistribution.length > 0 && (
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.ttrDistribution")}
          </h2>
          <div className="rounded-xl bg-surface-container-low p-4">
            <Histogram
              bars={ttrDistribution.map((b) => ({
                label: t(TTR_BUCKET_LABELS[b.bucket]),
                count: b.count,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
