import type { JobStatusType } from "@shared/constants";
import { JOB_STATUS_FLOW } from "@shared/constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useTechnicians } from "@/hooks/use-technicians";
import { useJobsStore } from "@/stores/jobs";

interface BatchActionBarProps {
  onClear: () => void;
  selectedIds: Set<string>;
  selectedJobs: Array<{ id: string; status: JobStatusType }>;
}

export default function BatchActionBar({
  selectedIds,
  selectedJobs,
  onClear,
}: BatchActionBarProps) {
  const { t } = useTranslation();
  const transitionStatus = useJobsStore((s) => s.transitionStatus);
  const updateJob = useJobsStore((s) => s.updateJob);
  const { technicians, isLoading: techsLoading } = useTechnicians();
  const [loading, setLoading] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

  const statusMenuRef = useClickOutside(() => setStatusOpen(false));
  const techMenuRef = useClickOutside(() => setTechOpen(false));

  useEffect(() => {
    if (!(statusOpen || techOpen)) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setStatusOpen(false);
        setTechOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [statusOpen, techOpen]);

  const commonTransitions = useMemo(() => {
    if (selectedJobs.length === 0) {
      return [];
    }
    const transitionSets = selectedJobs.map(
      (j) => new Set(JOB_STATUS_FLOW[j.status] ?? [])
    );
    let common = transitionSets[0];
    for (const ts of transitionSets.slice(1)) {
      common = new Set([...common].filter((s) => ts.has(s)));
    }
    // Transitions that require extra input (reason / labor hours / QC
    // checklist / delivery payment) can't be done in bulk — the detail-page
    // popover owns them. DELIVERED is irreversible and always goes through
    // the delivery dialog (balance, payment, receipt).
    return [...common].filter(
      (s) =>
        s !== "CANCELLED" &&
        s !== "ON_HOLD" &&
        s !== "DONE" &&
        s !== "DELIVERED"
    );
  }, [selectedJobs]);

  const handleStatusTransition = useCallback(
    async (status: JobStatusType) => {
      setLoading(true);
      let succeeded = 0;
      const previousStatuses = new Map<string, JobStatusType>();
      for (const job of selectedJobs) {
        previousStatuses.set(job.id, job.status);
      }

      await Promise.allSettled(
        selectedJobs.map(async (job) => {
          try {
            await transitionStatus(job.id, status);
            succeeded++;
          } catch {
            /* individual failure, count at end */
          }
        })
      );

      setLoading(false);
      setStatusOpen(false);

      if (succeeded === selectedJobs.length) {
        toast(t("batch_status_success", { count: succeeded }), {
          action: {
            label: t("undo"),
            onClick: async () => {
              let undoOk = 0;
              let undoFail = 0;
              await Promise.allSettled(
                selectedJobs.map(async (job) => {
                  const prev = previousStatuses.get(job.id);
                  if (prev) {
                    try {
                      await transitionStatus(job.id, prev);
                      undoOk++;
                    } catch {
                      undoFail++;
                    }
                  }
                })
              );
              if (undoFail > 0) {
                toast.error(
                  t("batch_undo_partial", {
                    ok: undoOk,
                    fail: undoFail,
                  })
                );
              }
            },
          },
          duration: 5000,
        });
      } else if (succeeded > 0) {
        toast.success(
          t("batch_status_partial", {
            count: succeeded,
            total: selectedJobs.length,
          })
        );
      } else {
        toast.error(t("batch_status_failed"));
      }

      onClear();
    },
    [selectedJobs, transitionStatus, t, onClear]
  );

  const handleAssignTechnician = useCallback(
    async (techId: string | null) => {
      setLoading(true);
      let succeeded = 0;

      await Promise.allSettled(
        selectedJobs.map(async (job) => {
          try {
            await updateJob(job.id, { technicianId: techId });
            succeeded++;
          } catch {
            /* individual failure */
          }
        })
      );

      setLoading(false);
      setTechOpen(false);

      if (succeeded === selectedJobs.length) {
        toast.success(t("batch_assign_success", { count: succeeded }));
      } else if (succeeded > 0) {
        toast.success(
          t("batch_assign_partial", {
            count: succeeded,
            total: selectedJobs.length,
          })
        );
      } else {
        toast.error(t("batch_assign_failed"));
      }

      onClear();
    },
    [selectedJobs, updateJob, t, onClear]
  );

  if (selectedIds.size === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-2xl bg-surface-container-lowest px-5 py-3 shadow-2xl">
        <span className="font-bold font-headline text-on-surface text-sm">
          {t("selected_count", { count: selectedIds.size })}
        </span>

        <div className="h-6 w-px bg-outline-variant" />

        {commonTransitions.length > 0 && (
          <div className="relative" ref={statusMenuRef}>
            <button
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold font-label text-on-surface text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-low"
              disabled={loading}
              onClick={() => setStatusOpen((p) => !p)}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">
                arrow_forward
              </span>
              {t("batch_change_status")}
            </button>
            {statusOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-outline-variant/20 bg-surface-container-lowest py-1 shadow-xl">
                {commonTransitions.map((status) => (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low"
                    disabled={loading}
                    key={status}
                    onClick={() => handleStatusTransition(status)}
                    type="button"
                  >
                    <span>{t(`status.${status}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="relative" ref={techMenuRef}>
          <button
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold font-label text-on-surface text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-low"
            disabled={loading}
            onClick={() => setTechOpen((p) => !p)}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">person</span>
            {t("batch_assign_tech")}
          </button>
          {techOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-outline-variant/20 bg-surface-container-lowest py-1 shadow-xl">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low"
                disabled={loading}
                onClick={() => handleAssignTechnician(null)}
                type="button"
              >
                {t("unassigned")}
              </button>
              {!techsLoading &&
                technicians.map((tech) => (
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low"
                    disabled={loading}
                    key={tech.id}
                    onClick={() => handleAssignTechnician(tech.id)}
                    type="button"
                  >
                    {tech.name}
                  </button>
                ))}
            </div>
          )}
        </div>

        <button
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold font-label text-on-surface-variant text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-low"
          onClick={onClear}
          type="button"
        >
          <span className="material-symbols-outlined text-sm">close</span>
          {t("deselect")}
        </button>
      </div>
    </div>
  );
}
