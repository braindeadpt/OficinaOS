import type { JobStatusType } from "@shared/constants";
import type { OwnerDashboardDTO } from "@shared/types/dashboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import AiCallout from "@/components/modules/dashboard/ai-callout";
import FinancialTrend from "@/components/modules/dashboard/financial-trend";
import JobPipeline from "@/components/modules/dashboard/job-pipeline";
import OverdueJobs from "@/components/modules/dashboard/overdue-jobs";
import ReadyForPickup from "@/components/modules/dashboard/ready-for-pickup";
import { Icon } from "@/components/ui/icon";
import MetricCard from "@/components/ui/metric-card";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
import { currencySymbol, formatNumber } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import { useDashboardStore } from "@/stores/dashboard";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

const EMPTY_PIPELINE: Record<JobStatusType, number> = {
  INTAKE: 0,
  WAITING_FOR_PARTS: 0,
  IN_REPAIR: 0,
  ON_HOLD: 0,
  DONE: 0,
  DELIVERED: 0,
  RETURNED: 0,
  CANCELLED: 0,
};

function resolveLocale(lang: string): string {
  if (lang === "fr") {
    return "fr-FR";
  }
  if (lang === "en") {
    return "en-US";
  }
  if (lang === "es") {
    return "es-ES";
  }
  return "pt-PT";
}

function usePrevMonthName(): string {
  const { i18n } = useTranslation();
  return useMemo(() => {
    // setMonth(-1) on the 31st overflows into the following month
    // (Mar 31 → Mar 3, not Feb) — anchor to the 1st before subtracting.
    const now = new Date();
    now.setDate(1);
    now.setMonth(now.getMonth() - 1);
    return now.toLocaleDateString(resolveLocale(i18n.language), {
      month: "short",
    });
  }, [i18n.language]);
}

function DashboardHeader({
  canCreateJob,
  userName,
}: {
  canCreateJob: boolean;
  userName: string;
}) {
  const { t } = useTranslation();
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);

  return (
    <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
          {t("dashboard_greeting", { name: userName })}
        </h2>
        <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
          {t("realtime_status")}
        </p>
      </div>

      <div className="flex w-full flex-wrap gap-3 sm:w-auto">
        <button
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold font-headline text-on-primary text-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none md:px-8"
          disabled={!canCreateJob}
          onClick={() => openIntakeModal()}
          type="button"
        >
          <Icon className="text-[18px] md:text-[20px]" name="add_box" />
          <span className="whitespace-nowrap">{t("new_checkin")}</span>
        </button>
      </div>
    </div>
  );
}

function EmptyStateBanner({ canCreateJob }: { canCreateJob: boolean }) {
  const { t } = useTranslation();
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);

  return (
    <div className="mb-10 flex flex-col items-center justify-center rounded-2xl bg-surface-container-low py-16 text-center">
      <Icon className="mb-3 text-5xl text-surface-variant" name="build" />
      <h3 className="font-bold font-headline text-lg text-on-surface">
        {t("dashboard_page.empty_title")}
      </h3>
      <p className="mt-1 max-w-sm text-on-surface-variant text-sm">
        {t("dashboard_page.empty_description")}
      </p>
      <button
        className="mt-5 rounded-xl bg-primary px-6 py-2.5 font-bold text-on-primary text-sm transition-all hover:bg-primary-container hover:text-on-primary-container"
        disabled={!canCreateJob}
        onClick={() => openIntakeModal()}
        type="button"
      >
        {t("dashboard_page.empty_cta")}
      </button>
    </div>
  );
}

function MetricsGrid({
  activeJobs,
  benchUtilization,
  completedToday,
  pipelineTotal,
  data,
  openReturnsCount,
}: {
  activeJobs: number;
  benchUtilization: number;
  completedToday: number;
  pipelineTotal: number;
  data: OwnerDashboardDTO | null;
  openReturnsCount: number;
}) {
  const { t } = useTranslation();
  const prevMonthName = usePrevMonthName();
  const canViewReturns = useCan({ returns: ["viewSelf"] });
  const canViewShop = useCan({ returns: ["viewShop"] });
  const [warrantyCost, setWarrantyCost] = useState<number | null>(null);
  const currency = useSettingsStore((s) => s.shopSettings?.currency) ?? "EUR";

  useEffect(() => {
    if (!(canViewShop && data)) {
      return;
    }
    let cancelled = false;
    api
      .get("/reports/returns?range=month")
      .then((res) => {
        if (cancelled) {
          return;
        }
        const cost = res.data?.summary?.netWarrantyCost;
        if (typeof cost === "number" && cost > 0) {
          setWarrantyCost(cost);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWarrantyCost(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canViewShop, data]);

  const revenueChangePct = data?.revenueChangePct ?? 0;
  const marginChange = data?.avgProfitMarginChange ?? 0;
  const revenueDir = revenueChangePct >= 0 ? "up" : "down";
  const marginDir = marginChange >= 0 ? "up" : "down";

  const formatPct = useCallback(
    (val: number) => `${val >= 0 ? "+" : ""}${val}`,
    []
  );

  return (
    <div
      className={`mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4 ${
        canViewReturns ? "xl:grid-cols-5" : ""
      }`}
    >
      <MetricCard
        detail={t("dashboard_page.since_8am", { count: activeJobs })}
        icon="precision_manufacturing"
        label={t("active_jobs")}
        labelTooltip={t("dashboard_page.active_jobs_tooltip")}
        value={String(activeJobs)}
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full bg-primary"
            style={{ width: `${Math.min(100, benchUtilization)}%` }}
          />
        </div>
      </MetricCard>

      <MetricCard
        detail={t("dashboard_page.pipeline_share", {
          total: pipelineTotal,
        })}
        icon="check_circle"
        iconColor="text-on-secondary-container"
        label={t("completed_today")}
        value={String(completedToday)}
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full bg-on-secondary-container"
            style={{
              width: `${Math.min(
                100,
                pipelineTotal > 0
                  ? Math.round((completedToday / pipelineTotal) * 100)
                  : 0
              )}%`,
            }}
          />
        </div>
      </MetricCard>

      <MetricCard
        detail={
          data
            ? `${formatPct(revenueChangePct)}% ${t("dashboard_page.vs_month", { month: prevMonthName })}`
            : ""
        }
        icon="payments"
        iconColor="text-on-secondary-container"
        label={t("revenue_this_month")}
        labelTooltip={t("dashboard_page.revenue_tooltip")}
        unit={currencySymbol(currency)}
        value={data ? data.revenueThisMonth.toFixed(2) : "--"}
      >
        {data && data.revenueThisMonth > 0 && (
          <div
            className={`flex items-center gap-1 font-bold text-xs ${revenueDir === "up" ? "text-on-secondary-container" : "text-error"}`}
          >
            <Icon className="text-[14px]" name={`trending_${revenueDir}`} />
            {formatPct(revenueChangePct)}%{" "}
            {t("dashboard_page.vs_last_month_short")}
          </div>
        )}
        {warrantyCost !== null && (
          <p className="mt-1 text-on-surface-variant text-xs">
            {t("dashboard_page.warranty_cost_inline", {
              amount: formatNumber(warrantyCost, 2),
            })}
          </p>
        )}
        {data?.monthlyRevenueGoal ? (
          <div className="mt-2">
            <div className="flex items-center justify-between font-label text-on-surface-variant text-xs">
              <span>
                {t("dashboard_page.goal_label", {
                  goal: formatNumber(data.monthlyRevenueGoal),
                })}
              </span>
              <span className="font-bold">
                {Math.min(
                  999,
                  Math.round(
                    (data.revenueThisMonth / data.monthlyRevenueGoal) * 100
                  )
                )}
                %
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className={`h-full transition-all ${
                  data.revenueThisMonth >= data.monthlyRevenueGoal
                    ? "bg-on-secondary-container"
                    : "bg-primary"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    (data.revenueThisMonth / data.monthlyRevenueGoal) * 100
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : null}
      </MetricCard>

      <MetricCard
        detail={
          data
            ? `${formatPct(marginChange)}pp ${t("dashboard_page.vs_month", { month: prevMonthName })}`
            : ""
        }
        icon="bar_chart"
        label={t("avg_profit_margin")}
        unit="%"
        value={data ? `${Math.round(data.avgProfitMargin)}` : "--"}
      >
        {data && data.avgProfitMargin > 0 && (
          <span
            className={`font-bold text-xs ${marginDir === "up" ? "text-on-secondary-container" : "text-error"}`}
          >
            <Icon className="text-[14px]" name={`trending_${marginDir}`} />
            {formatPct(marginChange)}pp
          </span>
        )}
      </MetricCard>

      {canViewReturns && (
        <MetricCard
          className="sm:col-span-2 xl:col-span-1"
          detail={t("returns_dashboard_open_card_subtitle")}
          icon="undo"
          label={t("returns_dashboard_open_card_title")}
          value={String(openReturnsCount)}
        />
      )}
    </div>
  );
}

function DashboardDataGrid({
  benchUtilization,
  pipelineCounts,
  data,
  isAiEnabled,
}: {
  benchUtilization: number;
  pipelineCounts: Record<JobStatusType, number>;
  data: OwnerDashboardDTO;
  isAiEnabled: boolean;
}) {
  const { t } = useTranslation();

  const revenueChangePct = data.revenueChangePct ?? 0;
  const marginChange = data.avgProfitMarginChange ?? 0;

  const insight = useMemo(() => {
    const parts: string[] = [];

    if (revenueChangePct >= 15) {
      parts.push(t("ai_insight_revenue_strong", { pct: revenueChangePct }));
    } else if (revenueChangePct <= -15) {
      parts.push(
        t("ai_insight_revenue_weak", { pct: Math.abs(revenueChangePct) })
      );
    }

    if (marginChange >= 5) {
      parts.push(t("ai_insight_margin_up", { pp: marginChange }));
    } else if (marginChange <= -5) {
      parts.push(t("ai_insight_margin_down", { pp: Math.abs(marginChange) }));
    }

    if (data.completedToday === 0 && data.activeJobs > 0) {
      parts.push(t("ai_insight_completion_stall", { count: data.activeJobs }));
    }

    if (parts.length > 0) {
      return parts.join(" ");
    }

    if (data.completedToday > 0) {
      return t("ai_insight_default_positive", {
        completed: data.completedToday,
        active: data.activeJobs,
      });
    }

    return t("ai_insight_default_neutral");
  }, [revenueChangePct, marginChange, data.completedToday, data.activeJobs, t]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:gap-8">
      <div className="md:col-span-12 lg:col-span-4">
        <JobPipeline benchCapacity={benchUtilization} counts={pipelineCounts} />
      </div>

      <div className="space-y-8 md:col-span-12 lg:col-span-5">
        <FinancialTrend data={data.financialTrend} />
        {isAiEnabled && <AiCallout insight={insight} />}
      </div>

      <div className="space-y-6 md:col-span-12 lg:col-span-3">
        <OverdueJobs
          jobs={data.overdueJobs.map((j) => ({
            device: j.device,
            id: j.jobCode,
            lateness: t("dashboard_page.hours_late", {
              hours: j.hoursLate,
            }),
            repair: j.repairSummary,
          }))}
          warrantyReturns={data.warrantyReturns.map((w) => ({
            description: w.description,
            id: w.jobCode,
            priority: w.description.toLowerCase().includes("urgent")
              ? t("dashboard_page.high_priority")
              : undefined,
            timeAgo: t("dashboard_page.hours_ago", {
              hours: Math.round(
                (Date.now() - new Date(w.createdAt).getTime()) / 3_600_000
              ),
            }),
          }))}
        />
        <ReadyForPickup items={data.pickupReady} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="h-8 w-64 rounded-lg bg-surface-container-high" />
          <div className="mt-2 h-5 w-40 rounded-lg bg-surface-container-high" />
        </div>
        <div className="h-10 w-40 rounded-xl bg-surface-container-high" />
      </div>

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div className="rounded-xl bg-surface-container-low p-5" key={i}>
            <div className="h-3 w-24 rounded bg-surface-container-high" />
            <div className="mt-2 h-10 w-16 rounded bg-surface-container-high" />
            <div className="mt-2 h-3 w-32 rounded bg-surface-container-high" />
            <div className="mt-3 h-1 w-full rounded-full bg-surface-container-high" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-12 lg:col-span-4">
          <div className="h-full rounded-xl bg-surface-container-low p-6">
            <div className="mb-6 h-6 w-48 rounded bg-surface-container-high" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div className="mb-3 flex items-center justify-between" key={i}>
                <div className="flex items-center gap-3">
                  <div className="h-2.5 w-2.5 rounded-full bg-surface-container-high" />
                  <div className="h-4 w-32 rounded bg-surface-container-high" />
                </div>
                <div className="h-5 w-8 rounded bg-surface-container-high" />
              </div>
            ))}
            <div className="mt-8 h-16 rounded-xl bg-surface-container-high" />
          </div>
        </div>

        <div className="space-y-8 md:col-span-12 lg:col-span-5">
          <div className="rounded-xl bg-surface-container-low p-6">
            <div className="mb-8 flex justify-between">
              <div className="h-6 w-32 rounded bg-surface-container-high" />
              <div className="flex gap-4">
                <div className="h-3 w-16 rounded bg-surface-container-high" />
                <div className="h-3 w-16 rounded bg-surface-container-high" />
              </div>
            </div>
            <div className="flex h-48 items-end gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div
                  className="flex-1 rounded-t bg-surface-container-high"
                  key={i}
                  style={{ height: `${20 + (i % 4) * 15}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="md:col-span-12 lg:col-span-3">
          <div className="rounded-xl bg-surface-container-lowest p-6">
            <div className="mb-6 h-6 w-32 rounded bg-surface-container-high" />
            {[1, 2].map((i) => (
              <div className="mb-4" key={i}>
                <div className="mb-1 h-3 w-full rounded bg-surface-container-high" />
                <div className="h-3 w-24 rounded bg-surface-container-high" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const userName = useAuthStore((s) => s.user?.name || s.user?.username || "");
  const { data, fetchDashboard, isLoading } = useDashboardStore();
  const canCreateJob = useCan({ jobs: ["create"] });
  const [openReturnsCount, setOpenReturnsCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/return-claims", { params: { status: "OPEN", limit: 1 } })
      .then((res) => {
        if (!cancelled) {
          setOpenReturnsCount(res.data?.total ?? 0);
        }
      })
      .catch(() => {
        setOpenReturnsCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const aiSettings = useSettingsStore((s) => s.aiSettings);
  const fetchAiSettings = useSettingsStore((s) => s.fetchAiSettings);
  const isAiEnabled = aiSettings?.enabled ?? false;

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    fetchAiSettings();
  }, [fetchAiSettings]);

  const pipelineCounts = useMemo(
    () => data?.pipeline ?? EMPTY_PIPELINE,
    [data?.pipeline]
  );
  const activeJobs = useMemo(
    () =>
      pipelineCounts.INTAKE +
      pipelineCounts.IN_REPAIR +
      pipelineCounts.ON_HOLD +
      pipelineCounts.WAITING_FOR_PARTS,
    [pipelineCounts]
  );
  const completedToday = data?.completedToday ?? 0;

  const pipelineTotal = useMemo(
    () => Object.values(pipelineCounts).reduce((sum, c) => sum + c, 0),
    [pipelineCounts]
  );
  const benchUtilization =
    pipelineTotal > 0 ? Math.round((activeJobs / pipelineTotal) * 100) : 0;

  const hasData = pipelineTotal > 0 || data?.completedToday !== undefined;
  const isEmpty = !(isLoading || hasData);

  return (
    <>
      <DashboardHeader canCreateJob={canCreateJob} userName={userName} />

      {isLoading && <DashboardSkeleton />}

      {!isLoading && isEmpty && (
        <EmptyStateBanner canCreateJob={canCreateJob} />
      )}

      {!isLoading && (
        <MetricsGrid
          activeJobs={activeJobs}
          benchUtilization={benchUtilization}
          completedToday={completedToday}
          data={data}
          openReturnsCount={openReturnsCount}
          pipelineTotal={pipelineTotal}
        />
      )}

      {!(isLoading || isEmpty) && data && (
        <DashboardDataGrid
          benchUtilization={benchUtilization}
          data={data}
          isAiEnabled={isAiEnabled}
          pipelineCounts={pipelineCounts}
        />
      )}
    </>
  );
}
