import { JobStatus, type JobStatusType } from "@shared/constants";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import PartsAlert from "@/components/modules/dashboard/parts-alert";
import PriorityActions from "@/components/modules/dashboard/priority-actions";
import RecentActivity from "@/components/modules/dashboard/recent-activity";
import TechJobPipeline from "@/components/modules/dashboard/tech-job-pipeline";
import TechnicianKanban from "@/components/modules/dashboard/technician-kanban";
import TodaySchedule from "@/components/modules/dashboard/today-schedule";
import { Icon } from "@/components/ui/icon";
import MetricCard from "@/components/ui/metric-card";
import { formatTimeAgo } from "@/lib/format-time-ago";
import { useDashboardStore } from "@/stores/dashboard";
import { useJobsStore } from "@/stores/jobs";

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

const ACTION_ICON_MAP: Record<
  string,
  { icon: string; iconColor: string; textKey: string }
> = {
  JOB_CREATED: {
    icon: "add_circle",
    iconColor: "bg-primary/10 text-primary",
    textKey: "tech_dashboard.activity_job_created",
  },
  STATUS_CHANGED: {
    icon: "swap_horiz",
    iconColor: "bg-secondary/10 text-secondary",
    textKey: "tech_dashboard.activity_status_changed",
  },
  REPAIR_ADDED: {
    icon: "build",
    iconColor: "bg-tertiary/10 text-tertiary",
    textKey: "tech_dashboard.activity_repair_added",
  },
  PART_ADDED: {
    icon: "inventory_2",
    iconColor: "bg-tertiary/10 text-tertiary",
    textKey: "tech_dashboard.activity_part_added",
  },
  JOB_UPDATED: {
    icon: "edit",
    iconColor: "bg-primary/10 text-primary",
    textKey: "tech_dashboard.activity_job_updated",
  },
  TECHNICIAN_ASSIGNED: {
    icon: "person_add",
    iconColor: "bg-secondary/10 text-secondary",
    textKey: "tech_dashboard.activity_tech_assigned",
  },
  COST_UPDATED: {
    icon: "payments",
    iconColor: "bg-tertiary/10 text-tertiary",
    textKey: "tech_dashboard.activity_cost_updated",
  },
};

const PARTS_ALERTS_EMPTY: Array<{
  name: string;
  quantity: number;
  stockLevel: number;
  threshold: number;
}> = [];

export default function TechnicianDashboardPage() {
  const { i18n, t } = useTranslation();
  const { metrics, fetchMetrics } = useJobsStore();
  const { techData, techLoading, fetchTechnician } = useDashboardStore();

  useEffect(() => {
    fetchMetrics().catch(() => {
      /* metrics fetch handled by store */
    });
    fetchTechnician();
  }, [fetchMetrics, fetchTechnician]);

  const pipelineCounts = useMemo<Record<JobStatusType, number>>(() => {
    if (!metrics) {
      return EMPTY_PIPELINE;
    }
    return Object.fromEntries(
      Object.values(JobStatus).map((status) => [status, metrics[status] ?? 0])
    ) as Record<JobStatusType, number>;
  }, [metrics]);

  const activeJobs = techData?.myActiveJobs ?? metrics?.IN_REPAIR ?? 0;
  const completedToday = techData?.completedToday ?? metrics?.DONE ?? 0;
  const waitingForParts =
    techData?.waitingForParts ?? metrics?.WAITING_FOR_PARTS ?? 0;
  const avgRepairTime = techData?.avgRepairTimeHours ?? 0;

  const totalPipeline = techData?.pipeline
    ? Object.values(techData.pipeline).reduce((sum, c) => sum + c, 0)
    : 0;
  const workloadPct =
    totalPipeline > 0 ? Math.round((activeJobs / totalPipeline) * 100) : 0;

  // Map real schedule data from API
  const scheduleItems = useMemo(() => {
    if (!techData?.todaySchedule) {
      return [];
    }
    return techData.todaySchedule.map((s) => ({
      customerName: s.customerName,
      device: s.device,
      id: s.jobCode,
      repairType: s.repairSummary,
      status: s.status,
      time: s.estimatedDate
        ? new Date(s.estimatedDate).toLocaleTimeString(i18n.language, {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—",
    }));
  }, [techData?.todaySchedule, i18n.language]);

  // Map real activity data from API
  const activityItems = useMemo(() => {
    if (!techData?.recentActivity) {
      return [];
    }
    return techData.recentActivity.map((a) => {
      const mapping = ACTION_ICON_MAP[a.action] ?? {
        icon: "info",
        iconColor: "bg-primary/10 text-primary",
        textKey: "tech_dashboard.activity_generic",
      };
      return {
        icon: mapping.icon,
        iconColor: mapping.iconColor,
        id: a.jobCode ?? a.id,
        textKey: mapping.textKey,
        timeAgo: formatTimeAgo(a.createdAt),
      };
    });
  }, [techData?.recentActivity]);

  // Map real priority actions from API
  const priorityActions = useMemo(() => {
    if (!techData?.priorityActions) {
      return [];
    }
    return [
      {
        count: techData.priorityActions.jobsNeedingStatusUpdate,
        labelKey: "tech_dashboard.jobs_need_status",
        variant: "default" as const,
      },
      {
        count: techData.priorityActions.overdueCount,
        labelKey: "tech_dashboard.job_overdue_deadline",
        variant: "warning" as const,
      },
      {
        count: techData.priorityActions.partsWaitingCount,
        labelKey: "tech_dashboard.parts_requests_pending",
        variant: "default" as const,
      },
    ].filter((a) => a.count > 0);
  }, [techData?.priorityActions]);

  const partsAlertItems = useMemo(() => {
    if (!techData?.partsAlerts) {
      return PARTS_ALERTS_EMPTY;
    }
    return techData.partsAlerts.map((p) => ({
      name: p.name,
      quantity: p.stockQuantity,
      stockLevel: p.reorderLevel * 2,
      threshold: p.reorderLevel,
    }));
  }, [techData?.partsAlerts]);

  if (!techData && techLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Icon
          className="animate-spin text-4xl text-primary"
          name="progress_activity"
        />
      </div>
    );
  }

  return (
    <>
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("tech_dashboard.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("tech_dashboard.subtitle")}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-surface-container-highest px-4 py-2.5 font-bold font-headline text-on-secondary-fixed-variant text-sm transition-all hover:bg-surface-container-high sm:flex-none md:px-6"
            type="button"
          >
            <Icon className="text-[18px] md:text-[20px]" name="monitoring" />
            <span className="whitespace-nowrap">
              {t("tech_dashboard.my_performance")}
            </span>
          </button>
          <button
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold font-headline text-on-primary text-sm transition-all hover:opacity-90 sm:flex-none md:px-8"
            type="button"
          >
            <Icon className="text-[18px] md:text-[20px]" name="swap_horiz" />
            <span className="whitespace-nowrap">
              {t("tech_dashboard.update_status")}
            </span>
          </button>
        </div>
      </div>

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-6 lg:grid-cols-4">
        <MetricCard
          detail={t("dashboard_page.since_8am", { count: activeJobs })}
          icon="precision_manufacturing"
          label={t("tech_dashboard.my_active_jobs")}
          value={String(activeJobs)}
        >
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, workloadPct)}%` }}
            />
          </div>
          <span className="mt-2 block font-bold text-primary text-xs">
            {workloadPct}% {t("tech_dashboard.workload")}
          </span>
        </MetricCard>

        <MetricCard
          detail={
            completedToday >= 5
              ? t("tech_dashboard.daily_goal_achieved")
              : t("tech_dashboard.daily_goal_keep_going")
          }
          icon="emoji_events"
          iconColor="text-tertiary"
          label={t("tech_dashboard.daily_goal")}
          value={`${completedToday}/5`}
        >
          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className="h-full bg-tertiary"
              style={{
                width: `${Math.min(100, Math.round((completedToday / 5) * 100))}%`,
              }}
            />
          </div>
          <span className="mt-2 block font-bold text-tertiary text-xs">
            {t("tech_dashboard.daily_goal_progress", {
              completed: completedToday,
              target: 5,
            })}
          </span>
        </MetricCard>

        <MetricCard
          detail=""
          icon="inventory_2"
          iconColor="text-tertiary"
          label={t("tech_dashboard.waiting_for_parts")}
          value={String(waitingForParts)}
        >
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].slice(0, Math.min(waitingForParts, 5)).map((n) => (
              <div className="h-2 w-2 rounded-full bg-tertiary" key={n} />
            ))}
          </div>
          {waitingForParts > 0 && (
            <p className="mt-3 font-bold text-tertiary text-xs">
              {t("tech_dashboard.one_arriving_today")}
            </p>
          )}
        </MetricCard>

        <MetricCard
          detail={`${avgRepairTime}${t("tech_dashboard.avg_repair_time_unit")}`}
          icon="timer"
          iconColor="text-primary-container"
          label={t("tech_dashboard.avg_repair_time")}
          unit="h"
          value={String(avgRepairTime)}
        >
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                className={`h-1 flex-1 rounded-full ${i <= Math.min(Math.round(avgRepairTime), 5) ? "bg-tertiary" : "bg-surface-container-highest"}`}
                key={i}
              />
            ))}
          </div>
        </MetricCard>
      </div>

      <div className="mb-10">
        <TechnicianKanban />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12 md:gap-8">
        <div className="md:col-span-12 lg:col-span-4">
          <TechJobPipeline
            benchCapacity={workloadPct}
            benchTotal={totalPipeline}
            benchUsed={activeJobs}
            counts={pipelineCounts}
          />
        </div>

        <div className="space-y-8 md:col-span-12 lg:col-span-5">
          <TodaySchedule items={scheduleItems} />
          <RecentActivity items={activityItems} />
        </div>

        <div className="space-y-6 md:col-span-12 lg:col-span-3">
          <PriorityActions actions={priorityActions} />
          <PartsAlert items={partsAlertItems} />
        </div>
      </div>
    </>
  );
}
