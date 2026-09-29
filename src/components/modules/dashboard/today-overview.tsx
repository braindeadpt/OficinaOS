import type { JobStatusType } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { statusDotClass } from "@/lib/status-colors";

interface RecentIntake {
  device: string;
  id: string;
  status: JobStatusType;
  timeAgo: string;
}

interface TodayOverviewProps {
  completedToday: number;
  recentIntakes: RecentIntake[];
  totalToday: number;
}

export default function TodayOverview({
  completedToday,
  totalToday,
  recentIntakes,
}: TodayOverviewProps) {
  const { t } = useTranslation();
  const remaining = Math.max(0, totalToday - completedToday);
  const progressPercent =
    totalToday > 0 ? Math.min((completedToday / totalToday) * 100, 100) : 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-xl bg-surface-container-low p-6">
        <h2 className="mb-4 font-bold font-headline text-lg">
          {t("front_desk.todays_overview")}
        </h2>
        <div className="mb-4 flex items-end gap-3">
          <span className="font-extrabold font-headline text-5xl text-primary">
            {remaining}
          </span>
          <span className="mb-2 font-bold text-on-surface-variant">
            {t("front_desk.jobs_remaining")}
          </span>
        </div>
        <div
          aria-valuemax={totalToday}
          aria-valuemin={0}
          aria-valuenow={completedToday}
          className="h-3 w-full overflow-hidden rounded-full bg-surface-container-highest"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between">
          <p className="font-bold text-on-surface-variant text-xs">
            {t("front_desk.completed_count", { count: completedToday })}{" "}
            {t("front_desk.completed")}
          </p>
          <p className="font-bold text-primary text-xs">
            {t("front_desk.total_count", { count: totalToday })}{" "}
            {t("front_desk.total")}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-surface-container-lowest p-6 shadow-premium">
        <h3 className="mb-4 font-bold font-headline text-lg">
          {t("front_desk.recent_intakes")}
        </h3>
        {recentIntakes.length === 0 ? (
          <p className="font-medium text-on-surface-variant text-sm">
            {t("front_desk.no_recent_intakes")}
          </p>
        ) : (
          <div className="space-y-3">
            {recentIntakes.map((intake) => (
              <div
                className="flex items-center justify-between rounded-lg bg-surface-container-low p-3 transition-colors hover:bg-surface-container"
                key={intake.id}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${statusDotClass(intake.status)}`}
                  />
                  <div>
                    <p className="font-medium text-sm">{intake.device}</p>
                    <p className="text-on-surface-variant text-xs">
                      {intake.id}
                    </p>
                  </div>
                </div>
                <span className="font-bold text-on-surface-variant text-xs">
                  {intake.timeAgo}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
