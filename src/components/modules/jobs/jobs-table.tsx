import { DEVICE_ICONS } from "@shared/constants";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
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
    <div className="overflow-hidden rounded-xl bg-surface-container-lowest">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-start">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="w-12 p-4">
                <label className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-surface-container-high">
                  <span className="sr-only">{t("select_all")}</span>
                  <input
                    aria-label={t("select_all")}
                    checked={allSelected}
                    className="h-5 w-5 rounded border-outline-variant accent-primary"
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
              <th className="hidden p-4 font-body font-bold text-on-surface-variant text-xs uppercase tracking-wide md:table-cell">
                {t("job_id")}
              </th>
              <th className="p-4 font-body font-bold text-on-surface-variant text-xs uppercase tracking-wide">
                {t("device")}
              </th>
              <th className="hidden p-4 font-body font-bold text-on-surface-variant text-xs uppercase tracking-wide lg:table-cell">
                {t("customers")}
              </th>
              <th className="p-4 text-center font-body font-bold text-on-surface-variant text-xs uppercase tracking-wide">
                {t("status_label")}
              </th>
              <th className="p-4 font-body font-bold text-on-surface-variant text-xs uppercase tracking-wide">
                {t("technician")}
              </th>
              <th className="p-4 text-end font-body font-bold text-on-surface-variant text-xs uppercase tracking-wide">
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
                  className={`transition-colors hover:bg-surface-container-low ${isSelected ? "bg-primary-container/20" : ""}`}
                  key={job.id}
                >
                  <td className="p-4">
                    <label className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-surface-container-high">
                      <span className="sr-only">{`${t("select")} ${job.id}`}</span>
                      <input
                        aria-label={`${t("select")} ${job.id}`}
                        checked={isSelected}
                        className="h-5 w-5 rounded border-outline-variant accent-primary"
                        onChange={() => onToggleSelect(jobId)}
                        type="checkbox"
                      />
                    </label>
                  </td>
                  <td className="hidden p-4 md:table-cell">
                    <Link
                      className="font-bold font-headline text-primary text-xs tracking-tight hover:underline lg:text-sm"
                      to={`/jobs/${jobId}`}
                    >
                      {job.id}
                    </Link>
                  </td>
                  <td className="p-4">
                    <Link className="block rounded-xl" to={`/jobs/${jobId}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high">
                          <span className="material-symbols-outlined text-lg text-secondary lg:text-xl">
                            {DEVICE_ICONS[job.deviceIcon ?? "other"] ??
                              "precision_manufacturing"}
                          </span>
                        </div>
                        <div>
                          <p className="font-bold font-headline text-xs lg:text-sm">
                            {job.device}
                          </p>
                          {job.deviceSpec && (
                            <p className="font-body text-on-surface-variant text-xs">
                              {job.deviceSpec}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="hidden p-4 lg:table-cell">
                    <p className="font-body font-semibold text-sm">
                      {job.customer}
                    </p>
                    {job.customerTier && (
                      <p className="text-on-surface-variant text-xs">
                        {job.customerTier}
                      </p>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex justify-center">
                      <StatusBadge status={job.status} />
                    </div>
                  </td>
                  <td className="p-4">
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
                  <td className="p-4 text-end">
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
