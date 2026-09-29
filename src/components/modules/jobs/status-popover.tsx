import type { JobStatusType } from "@shared/constants";
import { JOB_STATUS_FLOW } from "@shared/constants";
import type { Job } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useClickOutside } from "@/hooks/use-click-outside";
import { getErrorMessage } from "@/lib/api";
import { useJobsStore } from "@/stores/jobs";

const REQUIRES_REASON: JobStatusType[] = ["ON_HOLD", "CANCELLED"];

interface StatusPopoverProps {
  job: Job;
  onChanged?: () => void;
}

export default function StatusPopover({ job, onChanged }: StatusPopoverProps) {
  const { t } = useTranslation();
  const transitionStatus = useJobsStore((s) => s.transitionStatus);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<JobStatusType | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useClickOutside(() => {
    setOpen(false);
    setPending(null);
    setReason("");
    setError(null);
  });
  const listRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const availableStatuses = JOB_STATUS_FLOW[job.status] ?? [];

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPending(null);
        setReason("");
        setError(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSelect = useCallback(
    (status: JobStatusType) => {
      if (REQUIRES_REASON.includes(status)) {
        setPending(status);
        setReason("");
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      const previousStatus = job.status;
      transitionStatus(job.id, status)
        .then(() => {
          setOpen(false);
          onChanged?.();
          toast(t("job_status_success"), {
            action: {
              label: t("undo"),
              onClick: () => {
                transitionStatus(job.id, previousStatus)
                  .then(() => {
                    onChanged?.();
                    toast.success(t("job_status_undone"));
                  })
                  .catch(() => {
                    toast.error(t("job_status_undo_failed"));
                  });
              },
            },
            duration: 5000,
          });
        })
        .catch((err: unknown) => {
          setError(getErrorMessage(err, t("jobs_status_change_error_unknown")));
          toast.error(t("job_status_failed"));
        })
        .finally(() => setLoading(false));
    },
    [job.id, job.status, transitionStatus, onChanged, t]
  );

  const handleConfirmReason = useCallback(async () => {
    if (!pending) {
      return;
    }
    setLoading(true);
    setError(null);
    const previousStatus = job.status;
    try {
      await transitionStatus(job.id, pending, reason.trim() || undefined);
      setOpen(false);
      setPending(null);
      setReason("");
      onChanged?.();
      toast(t("job_status_success"), {
        action: {
          label: t("undo"),
          onClick: () => {
            transitionStatus(job.id, previousStatus)
              .then(() => {
                onChanged?.();
                toast.success(t("job_status_undone"));
              })
              .catch(() => {
                toast.error(t("job_status_undo_failed"));
              });
          },
        },
        duration: 5000,
      });
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("jobs_status_change_error_unknown")));
      toast.error(t("job_status_failed"));
    } finally {
      setLoading(false);
    }
  }, [pending, reason, job.id, job.status, transitionStatus, onChanged, t]);

  const handleCancelReason = useCallback(() => {
    setPending(null);
    setReason("");
    setError(null);
  }, []);

  useEffect(() => {
    if (open && !pending) {
      listRef.current?.focus();
    }
  }, [open, pending]);

  if (availableStatuses.length === 0) {
    return <StatusBadge status={job.status} />;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-full transition-colors hover:brightness-95"
        onClick={() => {
          setOpen((prev) => !prev);
          setFocusedIndex(0);
        }}
        type="button"
      >
        <StatusBadge status={job.status} />
        <span className="material-symbols-outlined text-on-surface-variant text-sm">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open && (
        <div
          aria-activedescendant={
            open && !pending ? `status-option-${focusedIndex}` : undefined
          }
          aria-label={t("jobs_status_change_select_status")}
          className="absolute end-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl bg-surface-container-lowest shadow-lg ring-1 ring-outline-variant max-sm:start-4 max-sm:end-4 max-sm:w-auto"
          onKeyDown={(e) => {
            if (pending) {
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setFocusedIndex((prev) =>
                Math.min(prev + 1, availableStatuses.length - 1)
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setFocusedIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const status = availableStatuses[focusedIndex];
              if (status) {
                handleSelect(status);
              }
            }
          }}
          ref={listRef}
          role="listbox"
          tabIndex={0}
        >
          {!pending && (
            <ul className="py-1">
              {availableStatuses.map((status, index) => (
                <li key={status}>
                  <button
                    aria-selected={status === job.status}
                    className={`flex w-full items-center gap-2 px-4 py-2.5 text-start transition-colors hover:bg-surface-container-high ${focusedIndex === index ? "bg-surface-container-high ring-2 ring-primary/30 ring-inset" : ""}`}
                    disabled={loading}
                    id={`status-option-${index}`}
                    onClick={() => handleSelect(status)}
                    role="option"
                    type="button"
                  >
                    <StatusBadge status={status} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {pending && (
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={job.status} />
                <span className="material-symbols-outlined text-on-surface-variant text-sm">
                  arrow_forward
                </span>
                <StatusBadge status={pending} />
              </div>
              <label className="sr-only" htmlFor="status-reason">
                {t("jobs_status_change_reason_label")}
              </label>
              <textarea
                aria-describedby={error ? "status-reason-error" : undefined}
                aria-invalid={!!error}
                className="w-full resize-none rounded-xl bg-surface-container-highest px-4 py-3 font-body text-on-surface text-sm placeholder:text-outline"
                disabled={loading}
                id="status-reason"
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("jobs_status_change_reason_placeholder")}
                rows={2}
                value={reason}
              />
              {error && (
                <p
                  className="font-body text-error text-xs"
                  id="status-reason-error"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  className="min-h-[44px] rounded-xl px-4 py-2 font-bold font-headline text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high"
                  disabled={loading}
                  onClick={handleCancelReason}
                  type="button"
                >
                  {t("cancel")}
                </button>
                <button
                  className="flex min-h-[44px] items-center gap-1 rounded-xl bg-primary px-4 py-2 font-bold font-headline text-on-primary text-xs transition-colors hover:bg-primary-container disabled:opacity-60"
                  disabled={loading}
                  onClick={handleConfirmReason}
                  type="button"
                >
                  {loading && (
                    <span className="material-symbols-outlined animate-spin text-sm">
                      progress_activity
                    </span>
                  )}
                  {t("jobs_status_change_confirm")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
