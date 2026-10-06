import type { JobStatusType } from "@shared/constants";
import { JobStatus } from "@shared/constants";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Icon } from "@/components/ui/icon";
import { PIPELINE_ITEMS_ACCENT } from "@/lib/pipeline-items";

interface JobPipelineProps {
  benchCapacity: number;
  counts: Record<JobStatusType, number>;
}

export default function JobPipeline({
  counts,
  benchCapacity,
}: JobPipelineProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleStatusClick = useCallback(
    (status: JobStatusType) => {
      navigate(`/jobs?status=${status}`);
    },
    [navigate]
  );

  return (
    <div className="h-full rounded-xl bg-surface-container-low p-6 transition-all">
      <h3 className="mb-6 flex items-center gap-2 font-bold font-headline text-lg text-on-surface">
        <Icon name="account_tree" size="lg" />
        {t("repair_status_board")}
      </h3>
      <div className="space-y-3">
        {PIPELINE_ITEMS_ACCENT.map(({ status, color, descriptionKey }) => (
          <button
            className={`flex min-h-16 w-full cursor-pointer items-center justify-between rounded-xl p-3 text-start transition-all hover:bg-surface-container ${
              status === JobStatus.IN_REPAIR
                ? "bg-surface-container-highest"
                : ""
            }`}
            key={status}
            onClick={() => handleStatusClick(status)}
            type="button"
          >
            <div className="flex items-center gap-3">
              <div className={`h-2.5 w-2.5 rounded-full ${color}`} />
              <div className="text-start">
                <p className="font-bold text-on-surface text-sm">
                  {t(`status.${status}`)}
                </p>
                <p className="text-on-surface-variant text-xs">
                  {t(descriptionKey)}
                </p>
              </div>
            </div>
            <span className="font-extrabold font-headline text-on-surface text-xl">
              {String(counts[status]).padStart(2, "0")}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-8 rounded-xl bg-primary-fixed p-4 transition-all">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-primary text-xs uppercase">
            {t("bench_usage")}
          </p>
          <span className="font-bold text-primary text-xs">
            {benchCapacity}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-lowest/50">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${benchCapacity}%` }}
          />
        </div>
      </div>
    </div>
  );
}
