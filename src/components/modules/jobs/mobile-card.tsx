import type { JobStatusType } from "@shared/constants";
import { DEVICE_ICONS } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import JobActionsMenu from "./job-actions-menu";
import type { JobRow } from "./jobs-shared";
import TechnicianSelect from "./technician-select";

interface JobMobileCardProps {
  customer: string;
  customerTier?: string;
  device: string;
  deviceIcon?: string;
  id: string;
  isUrgent?: boolean;
  rawJob?: {
    id: string;
    technician?: { id: string; name: string } | null;
  };
  status: JobStatusType;
}

export default function JobMobileCard({
  id,
  rawJob,
  device,
  deviceIcon,
  status,
  customer,
  customerTier,
  isUrgent,
}: JobMobileCardProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl bg-surface-container-lowest p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high">
            <Icon
              className="text-secondary"
              name={
                DEVICE_ICONS[deviceIcon ?? "other"] ?? "precision_manufacturing"
              }
              size="lg"
            />
          </div>
          <div>
            <h3 className="font-bold font-headline text-sm">{device}</h3>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isUrgent && (
            <Icon className="text-base text-error" name="priority_high" />
          )}
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-on-surface-variant">
        <span className="font-body font-medium text-xs">{customer}</span>
        {customerTier && (
          <span className="rounded-full bg-primary-fixed px-2 py-0.5 font-bold font-label text-on-primary-fixed text-xs uppercase tracking-wider">
            {customerTier}
          </span>
        )}
      </div>

      <div className="-mx-4 mt-3 flex items-center justify-between bg-surface-container-low px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-container-highest">
            <Icon className="text-on-surface-variant text-sm" name="person" />
          </div>
          {rawJob ? (
            <TechnicianSelect
              currentTechnicianId={rawJob.technician?.id}
              currentTechnicianName={rawJob.technician?.name}
              jobId={rawJob.id}
              size="sm"
            />
          ) : (
            <span className="font-body font-medium text-on-surface-variant text-xs">
              {t("unassigned")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <JobActionsMenu
            job={{
              id,
              device,
              deviceIcon,
              status,
              customer,
              rawJob: rawJob as JobRow["rawJob"],
            }}
          />
          <Link
            className="flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-lg px-2 py-2 font-bold font-label text-primary text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-high"
            to={`/jobs/${rawJob?.id ?? id}`}
          >
            {t("details")}
            <Icon className="text-sm" name="chevron_right" />
          </Link>
        </div>
      </div>
    </div>
  );
}
