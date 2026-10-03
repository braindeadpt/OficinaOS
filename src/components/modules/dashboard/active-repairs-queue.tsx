import type { JobStatusType } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { statusContainerClass, statusDotClass } from "@/lib/status-colors";

interface RepairJob {
  completedAt?: string;
  customerName: string;
  deviceModel: string;
  estimatedCompletion?: string;
  id: string;
  jobCode: string;
  status: JobStatusType;
  technician: string;
}

interface ActiveRepairsQueueProps {
  jobs: RepairJob[];
}

export default function ActiveRepairsQueue({ jobs }: ActiveRepairsQueueProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold font-headline text-2xl tracking-tight">
          {t("front_desk.active_repairs")}
        </h2>
        <span className="rounded-full bg-surface-container px-3 py-1 font-label text-on-surface-variant text-sm">
          {t("front_desk.job_count", { count: jobs.length })}
        </span>
      </div>
      {jobs.length === 0 ? (
        <p className="font-medium text-on-surface-variant text-sm">
          {t("front_desk.no_active_repairs")}
        </p>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <Link
              className="block overflow-hidden rounded-xl bg-surface-container-lowest shadow-premium transition-colors hover:bg-surface-container-low"
              key={job.id}
              to={`/jobs/${job.id}`}
            >
              <div className="p-5">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <p className="mb-1 font-bold text-on-surface-variant text-xs uppercase tracking-wide">
                      {t("job_id")}: {job.jobCode}
                    </p>
                    <h3 className="font-extrabold font-headline text-primary text-xl">
                      {job.deviceModel}
                    </h3>
                    <p className="font-medium text-on-surface">
                      {job.customerName}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-bold font-label text-xs uppercase ${statusContainerClass(job.status)}`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${statusDotClass(job.status)}`}
                    />
                    {t(`status.${job.status}`)}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface-container-low p-4">
                  <div>
                    <p className="font-bold text-on-surface-variant text-xs uppercase">
                      {job.status === "DONE" || job.status === "DELIVERED"
                        ? t("front_desk.completed_at")
                        : t("front_desk.estimated_completion")}
                    </p>
                    <p className="font-bold text-sm">
                      {job.completedAt ?? job.estimatedCompletion}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="font-bold text-on-surface-variant text-xs uppercase">
                      {t("technician")}
                    </p>
                    <p className="font-bold text-sm">{job.technician}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Link
        className="flex min-h-11 w-full items-center justify-center rounded-xl bg-surface-container-low font-bold text-primary text-sm transition-colors hover:bg-surface-container"
        to="/jobs"
      >
        {t("front_desk.view_all_repairs")}
      </Link>
    </div>
  );
}
