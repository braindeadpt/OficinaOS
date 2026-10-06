import { DEVICE_ICONS } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import JobActionsMenu from "./job-actions-menu";
import type { JobRow } from "./jobs-shared";
import TechnicianSelect from "./technician-select";

interface JobsTableProps {
  jobs: JobRow[];
  onToggleSelect: (jobId: string) => void;
  onToggleSelectAll: () => void;
  selectedIds: Set<string>;
}

export default function JobsTable({
  jobs,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: JobsTableProps) {
  const { t } = useTranslation();

  const allSelected =
    jobs.length > 0 && jobs.every((j) => selectedIds.has(j.rawJob?.id ?? j.id));
  const someSelected = jobs.some((j) => selectedIds.has(j.rawJob?.id ?? j.id));

  return (
    <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-start">
          <thead>
            <tr className="sticky top-0 z-[1] border-outline-variant border-b bg-surface-container-low">
              <th className="w-12 px-3 py-2">
                <label className="flex min-h-8 pointer-coarse:min-h-11 min-w-8 pointer-coarse:min-w-11 items-center justify-center rounded-md hover:bg-surface-container-high">
                  <span className="sr-only">{t("select_all")}</span>
                  <input
                    aria-label={t("select_all")}
                    checked={allSelected}
                    className="h-4 pointer-coarse:h-5 pointer-coarse:w-5 w-4 rounded border-outline-variant accent-primary"
                    onChange={onToggleSelectAll}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = someSelected && !allSelected;
                      }
                    }}
                    type="checkbox"
                  />
                </label>
              </th>
              <th className="hidden px-3 py-2 font-semibold text-caption text-on-surface-variant uppercase tracking-[0.06em] md:table-cell">
                {t("job_id")}
              </th>
              <th className="px-3 py-2 font-semibold text-caption text-on-surface-variant uppercase tracking-[0.06em]">
                {t("device")}
              </th>
              <th className="hidden px-3 py-2 font-semibold text-caption text-on-surface-variant uppercase tracking-[0.06em] lg:table-cell">
                {t("customers")}
              </th>
              <th className="px-3 py-2 text-center font-semibold text-caption text-on-surface-variant uppercase tracking-[0.06em]">
                {t("status_label")}
              </th>
              <th className="px-3 py-2 font-semibold text-caption text-on-surface-variant uppercase tracking-[0.06em]">
                {t("technician")}
              </th>
              <th className="px-3 py-2 text-end font-semibold text-caption text-on-surface-variant uppercase tracking-[0.06em]">
                <span className="sr-only">{t("actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const jobId = job.rawJob?.id ?? job.id;
              const isSelected = selectedIds.has(jobId);
              return (
                <tr
                  className={`border-outline-variant border-b text-sm transition-colors last:border-b-0 hover:bg-surface-container-low ${isSelected ? "bg-primary-fixed" : ""}`}
                  key={job.id}
                >
                  <td className="px-3 pointer-coarse:py-2.5 py-1">
                    <label className="flex min-h-8 pointer-coarse:min-h-11 min-w-8 pointer-coarse:min-w-11 items-center justify-center rounded-md hover:bg-surface-container-high">
                      <span className="sr-only">{`${t("select")} ${job.id}`}</span>
                      <input
                        aria-label={`${t("select")} ${job.id}`}
                        checked={isSelected}
                        className="h-4 pointer-coarse:h-5 pointer-coarse:w-5 w-4 rounded border-outline-variant accent-primary"
                        onChange={() => onToggleSelect(jobId)}
                        type="checkbox"
                      />
                    </label>
                  </td>
                  <td className="hidden px-3 pointer-coarse:py-2.5 py-1 md:table-cell">
                    <Link
                      className="whitespace-nowrap font-medium font-mono text-link text-sm hover:underline"
                      to={`/jobs/${jobId}`}
                    >
                      {job.id}
                    </Link>
                  </td>
                  <td className="px-3 pointer-coarse:py-2.5 py-1">
                    <Link className="block rounded-md" to={`/jobs/${jobId}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex pointer-coarse:size-9 size-7 shrink-0 items-center justify-center rounded-md bg-surface-container-high">
                          <Icon
                            className="text-on-surface-variant"
                            name={
                              DEVICE_ICONS[job.deviceIcon ?? "other"] ??
                              "precision_manufacturing"
                            }
                            size="sm"
                          />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{job.device}</p>
                          {job.deviceSpec && (
                            <p className="font-body text-on-surface-variant text-xs">
                              {job.deviceSpec}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="hidden px-3 pointer-coarse:py-2.5 py-1 lg:table-cell">
                    <p className="text-sm">{job.customer}</p>
                    {job.customerTier && (
                      <p className="text-on-surface-variant text-xs">
                        {job.customerTier}
                      </p>
                    )}
                  </td>
                  <td className="px-3 pointer-coarse:py-2.5 py-1">
                    <div className="flex items-center justify-center gap-1.5">
                      {job.isUrgent && (
                        <Icon
                          aria-label={t("intake.urgent")}
                          className="text-danger"
                          name="priority_high"
                          size="sm"
                          title={t("intake.urgent")}
                        />
                      )}
                      <StatusBadge size="sm" status={job.status} />
                    </div>
                  </td>
                  <td className="px-3 pointer-coarse:py-2.5 py-1">
                    <div className="inline-block text-start">
                      {job.rawJob ? (
                        <TechnicianSelect
                          currentTechnicianId={job.rawJob.technician?.id}
                          currentTechnicianName={job.rawJob.technician?.name}
                          jobId={job.rawJob.id}
                          size="sm"
                        />
                      ) : (
                        <span className="font-body font-medium text-on-surface-variant text-xs italic">
                          {t("unassigned")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 pointer-coarse:py-2.5 py-1 text-end">
                    <JobActionsMenu job={job} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
