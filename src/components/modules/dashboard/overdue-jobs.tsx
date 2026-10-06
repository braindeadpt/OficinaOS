import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

interface OverdueJob {
  device: string;
  id: string;
  lateness: string;
  repair: string;
}

interface OverdueJobsProps {
  jobs: OverdueJob[];
  warrantyReturns: {
    id: string;
    description: string;
    priority?: string;
    timeAgo: string;
  }[];
}

export default function OverdueJobs({
  jobs,
  warrantyReturns,
}: OverdueJobsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-6 shadow-sm ring-1 ring-surface-container-low transition-all">
        <div className="mb-6 flex items-center gap-2">
          <Icon
            className="animate-pulse text-error"
            name="alarm_on"
            size="lg"
          />
          <h3 className="font-extrabold font-headline text-on-surface text-sm uppercase tracking-tight">
            {t("overdue_jobs")}
          </h3>
          {jobs.length > 0 && (
            <span className="ms-auto rounded-full bg-error px-2 py-0.5 font-black text-on-error text-xs shadow-sm">
              {String(jobs.length).padStart(2, "0")}
            </span>
          )}
        </div>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Icon
              className="mb-2 text-3xl text-surface-variant"
              name="schedule"
            />
            <p className="text-on-surface-variant text-sm">
              {t("overdue_jobs_empty")}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {jobs.map((job) => (
              <div className="group flex flex-col" key={job.id}>
                <div className="mb-1 flex items-start justify-between">
                  <span className="font-bold text-on-surface text-xs">
                    {job.device}
                  </span>
                  <span className="start-0 ms-auto font-black text-error text-xs uppercase">
                    {job.lateness}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-on-surface-variant text-xs uppercase tracking-wider">
                    {job.id} &bull; {job.repair}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {jobs.length > 0 && (
          <button
            className="mt-8 w-full text-center font-bold text-primary text-xs transition-all hover:underline"
            type="button"
          >
            {t("view_all_critical")}
          </button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-xl bg-surface-container-low p-6 ring-1 ring-surface-container-low/50 transition-all">
        <div className="mb-6 flex items-center gap-2">
          <Icon
            className="text-on-secondary-container"
            name="assignment_return"
            size="lg"
          />
          <h3 className="font-extrabold font-headline text-on-surface text-sm uppercase tracking-tight">
            {t("warranty_returns")}
          </h3>
        </div>
        {warrantyReturns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-4 text-center">
            <p className="text-on-surface-variant text-sm">
              {t("warranty_returns_empty")}
            </p>
          </div>
        ) : (
          warrantyReturns.map((wr, i) => (
            <div
              className={`mb-3 rounded-lg p-3 transition-all hover:bg-surface-container-low/30 ${
                i > 0
                  ? "opacity-60"
                  : "bg-surface-container-low/50 opacity-100 ring-1 ring-surface-container-low"
              }`}
              key={wr.id}
            >
              {wr.priority && (
                <div className="mb-2 flex items-center gap-3">
                  <Icon className="text-[18px] text-error" name="warning" />
                  <p className="font-bold text-on-surface text-xs">{wr.id}</p>
                </div>
              )}
              {!wr.priority && (
                <div className="mb-2 flex items-center gap-3">
                  <p className="font-bold text-on-surface text-xs">{wr.id}</p>
                </div>
              )}
              <p className="mb-3 text-on-surface-variant text-xs">
                {wr.description}
              </p>
              <div className="flex items-center justify-between">
                {wr.priority && (
                  <span className="rounded-full bg-error-container px-2 py-0.5 font-bold text-[9px] text-error">
                    {wr.priority}
                  </span>
                )}
                <span className="text-[9px] text-on-surface-variant opacity-60">
                  {wr.timeAgo}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
