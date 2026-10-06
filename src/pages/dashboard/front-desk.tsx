import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  type JobStatusType,
} from "@shared/constants";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ActiveRepairsQueue from "@/components/modules/dashboard/active-repairs-queue";
import PriorityAlertsPanel from "@/components/modules/dashboard/priority-alerts-panel";
import QuickIntakeForm from "@/components/modules/dashboard/quick-intake-form";
import QuickStatsChips from "@/components/modules/dashboard/quick-stats-chips";
import ReadyForPickup from "@/components/modules/dashboard/ready-for-pickup";
import TodayOverview from "@/components/modules/dashboard/today-overview";
import WaitingCustomers from "@/components/modules/dashboard/waiting-customers";
import { Icon } from "@/components/ui/icon";
import { formatTimeAgo } from "@/lib/format-time-ago";
import { useDashboardStore } from "@/stores/dashboard";
import { useJobsStore } from "@/stores/jobs";

function formatDate(date: Date | string, locale: string): string {
  const d = new Date(date);
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function FrontDeskPage() {
  const { i18n: i18nInstance, t } = useTranslation();
  const lang = i18nInstance.language;
  const { jobs, isLoadingJobs, fetchJobs } = useJobsStore();
  const { frontDeskData, frontDeskLoading, fetchFrontDesk } =
    useDashboardStore();

  useEffect(() => {
    fetchJobs();
    fetchFrontDesk();
  }, [fetchJobs, fetchFrontDesk]);

  // Map real jobs to the shape expected by ActiveRepairsQueue
  const activeRepairs = useMemo(() => {
    const isCompleted = (s: JobStatusType) =>
      COMPLETED_STATUSES.includes(s) || s === "CANCELLED";
    return jobs
      .filter(
        (j) => ACTIVE_STATUSES.includes(j.status) || isCompleted(j.status)
      )
      .map((j) => ({
        id: j.id,
        jobCode: j.jobCode,
        deviceModel: `${j.device.brand?.name ?? ""} ${j.device.model}`,
        customerName: j.customer.name,
        status: j.status,
        estimatedCompletion: j.estimatedDate
          ? formatDate(j.estimatedDate, lang)
          : undefined,
        completedAt:
          COMPLETED_STATUSES.includes(j.status) && j.updatedAt
            ? formatTimeAgo(j.updatedAt)
            : undefined,
        technician: j.technician?.name ?? t("front_desk.unassigned"),
      }));
  }, [jobs, lang, t]);

  // Recent intakes: latest 3 jobs with INTAKE status
  const recentIntakes = useMemo(
    () =>
      jobs
        .filter((j) => j.status === "INTAKE")
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 3)
        .map((j) => ({
          id: j.jobCode,
          device: `${j.device.brand?.name ?? ""} ${j.device.model}`,
          status: j.status,
          timeAgo: formatTimeAgo(j.createdAt),
        })),
    [jobs]
  );

  // Today's overview counts derived from jobs created today
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const { completedToday, totalToday } = useMemo(() => {
    const todayJobs = jobs.filter(
      (j) => new Date(j.createdAt).getTime() >= todayStart
    );
    const completed = todayJobs.filter((j) =>
      COMPLETED_STATUSES.includes(j.status)
    ).length;
    return { completedToday: completed, totalToday: todayJobs.length };
  }, [jobs, todayStart]);

  // Map priority alerts from API to component shape
  const priorityAlerts = useMemo(() => {
    if (!frontDeskData?.priorityAlerts) {
      return [];
    }
    return frontDeskData.priorityAlerts.map((a) => {
      const config: Record<
        string,
        {
          icon: string;
          title: string;
          variant: "error" | "secondary" | "tertiary";
        }
      > = {
        OVERDUE: {
          icon: "warning",
          title: t("front_desk.alert_overdue", { jobCode: a.jobCode }),
          variant: "error",
        },
        WARRANTY_RETURN: {
          icon: "history",
          title: t("front_desk.alert_warranty"),
          variant: "tertiary",
        },
        READY_FOR_PICKUP: {
          icon: "inventory_2",
          title: t("front_desk.alert_ready"),
          variant: "secondary",
        },
      };
      const c = config[a.kind] ?? {
        icon: "info",
        title: a.jobCode,
        variant: "default" as const,
      };
      return {
        description: a.customerName ?? a.jobCode,
        icon: c.icon,
        id: a.id,
        title: c.title,
        variant: c.variant,
      };
    });
  }, [frontDeskData?.priorityAlerts, t]);

  // Derive waiting customers from active repairs in INTAKE status
  const waitingCustomers = useMemo(() => {
    if (!frontDeskData?.activeRepairs) {
      return [];
    }
    const now = Date.now();
    return frontDeskData.activeRepairs
      .filter((r) => r.status === "INTAKE")
      .map((r) => ({
        id: r.id,
        initials: r.customerName
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase()
          .slice(0, 2),
        name: r.customerName,
        waitMinutes: Math.floor(
          (now - new Date(r.updatedAt).getTime()) / 60_000
        ),
      }));
  }, [frontDeskData?.activeRepairs]);

  if ((frontDeskLoading || isLoadingJobs) && jobs.length === 0) {
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
            {t("front_desk.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("front_desk.subtitle")}
          </p>
        </div>
      </div>

      <section className="mb-8 space-y-2">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          <button
            className="flex flex-col items-center gap-1 rounded-xl bg-surface-container-high px-2 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-secondary-fixed-dim hover:text-on-secondary-fixed sm:flex-row sm:justify-center sm:gap-2 sm:px-6"
            type="button"
          >
            <Icon className="text-lg" name="search" />
            <span className="text-[10px] leading-tight sm:text-xs sm:leading-normal">
              {t("front_desk.walk_in_lookup")}
            </span>
          </button>
          <button
            className="flex flex-col items-center gap-1 rounded-xl bg-surface-container-high px-2 py-2.5 font-semibold text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary sm:flex-row sm:justify-center sm:gap-2 sm:px-4"
            type="button"
          >
            <Icon className="text-lg" name="print" />
            <span className="text-[10px] leading-tight sm:text-xs sm:leading-normal">
              {t("front_desk.print_receipt")}
            </span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
        <div className="md:col-span-12 lg:col-span-5">
          <ActiveRepairsQueue jobs={activeRepairs} />
        </div>

        <div className="flex flex-col gap-8 md:col-span-12 lg:col-span-4">
          <TodayOverview
            completedToday={completedToday}
            recentIntakes={recentIntakes}
            totalToday={totalToday}
          />
          <QuickIntakeForm />
        </div>

        <div className="flex flex-col gap-8 md:col-span-12 lg:col-span-3">
          <PriorityAlertsPanel alerts={priorityAlerts} />
          <ReadyForPickup items={frontDeskData?.pickupReady ?? []} />
          <WaitingCustomers customers={waitingCustomers} />
          <QuickStatsChips
            stats={[
              {
                labelKey: "front_desk.mttr",
                value: String(frontDeskData?.avgRepairTimeHours ?? 0),
                unit: "h",
              },
              {
                labelKey: "front_desk.completed_today",
                value: String(
                  frontDeskData?.todayOverview?.completedToday ?? 0
                ),
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}
