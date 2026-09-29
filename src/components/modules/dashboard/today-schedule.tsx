import type { JobStatusType } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { statusDotClass } from "@/lib/status-colors";

interface ScheduleItem {
  customerName: string;
  device: string;
  id: string;
  repairType: string;
  status: JobStatusType;
  time: string;
}

interface TodayScheduleProps {
  items: ScheduleItem[];
}

export default function TodaySchedule({ items }: TodayScheduleProps) {
  const { t } = useTranslation();

  return (
    <div className="relative overflow-hidden rounded-xl bg-surface-container-low p-6">
      <h3 className="mb-6 font-bold font-headline text-lg text-on-surface">
        {t("tech_dashboard.today_schedule")}
      </h3>
      {items.length === 0 ? (
        <div className="rounded-xl bg-surface-container-lowest p-5 text-on-surface-variant text-sm">
          {t("no_jobs_found")}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              className="flex items-center justify-between rounded-xl bg-surface-container-lowest p-4 transition-colors hover:bg-surface-container"
              key={item.id}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-1 h-3 w-3 rounded-full ${statusDotClass(item.status)}`}
                />
                <div>
                  <p className="font-black text-primary text-xs">{item.time}</p>
                  <h5 className="mt-1 font-bold text-sm">
                    {item.device}{" "}
                    <span className="font-normal text-on-surface-variant text-xs">
                      / {item.customerName}
                    </span>
                  </h5>
                  <p className="mt-1 text-on-surface-variant text-xs">
                    {t("job_id")}: {item.id} &bull; {item.repairType}
                  </p>
                </div>
              </div>
              <button
                className="min-h-11 cursor-not-allowed rounded-xl bg-secondary/10 px-4 font-black text-secondary text-xs uppercase tracking-tighter opacity-50"
                disabled
                type="button"
              >
                {t("tech_dashboard.update")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
