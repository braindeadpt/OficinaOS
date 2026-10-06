import type { JobStatusType } from "@shared/constants";
import { JOB_STATUS_FLOW, QC_CHECK_ITEMS } from "@shared/constants";
import type { Job } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import DeliverJobDialog from "@/components/modules/jobs/deliver-job-dialog";
import FunctionalChecklist from "@/components/modules/jobs/intake-modal/functional-checklist";
import type { IntakeChecklist } from "@/components/modules/jobs/intake-modal/types";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { getErrorMessage } from "@/lib/api";
import { useJobsStore } from "@/stores/jobs";

const REQUIRES_REASON: JobStatusType[] = ["ON_HOLD", "CANCELLED"];

interface StatusPopoverProps {
  /** Outstanding balance as shown on the page; falls back to job.balanceDue. */
  balanceDue?: number;
  job: Job;
  onChanged?: () => void;
}

export default function StatusPopover({
  balanceDue: balanceDueProp,
  job,
  onChanged,
}: StatusPopoverProps) {
  const { t } = useTranslation();
  const transitionStatus = useJobsStore((s) => s.transitionStatus);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<JobStatusType | null>(null);
  const [reason, setReason] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [qc, setQc] = useState<IntakeChecklist>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useClickOutside(() => {
    setOpen(false);
    setPending(null);
    setReason("");
    setError(null);
  });
  const listRef = useRef<HTMLDivElement>(null);
  const qcDialogRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [delivering, setDelivering] = useState(false);

  const availableStatuses = JOB_STATUS_FLOW[job.status] ?? [];
  const balanceDue = balanceDueProp ?? job.balanceDue ?? 0;
  // DONE needs labor hours + a fully answered QC checklist (server requires
  // both) — too much for a 224px popover, so it opens as a proper dialog.
  const donePanel = pending === "DONE";

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

  const undoTransition = useCallback(
    (previousStatus: JobStatusType) => {
      transitionStatus(job.id, previousStatus)
        .then(() => {
          onChanged?.();
          toast.success(t("job_status_undone"));
        })
        .catch(() => {
          toast.error(t("job_status_undo_failed"));
        });
    },
    [job.id, transitionStatus, onChanged, t]
  );

  const notifySuccess = useCallback(
    (previousStatus: JobStatusType, target: JobStatusType) => {
      const canUndo = (JOB_STATUS_FLOW[target] ?? []).includes(previousStatus);
      toast(t("job_status_success"), {
        action: canUndo
          ? { label: t("undo"), onClick: () => undoTransition(previousStatus) }
          : undefined,
        duration: 5000,
      });
    },
    [undoTransition, t]
  );

  const handleSelect = useCallback(
    (status: JobStatusType) => {
      // Delivery is irreversible: always confirm it (balance, payment,
      // receipt) in its own dialog — never a one-click change.
      if (status === "DELIVERED") {
        setOpen(false);
        setPending(null);
        setDelivering(true);
        return;
      }
      if (status === "DONE") {
        setOpen(false);
      }
      if (REQUIRES_REASON.includes(status) || status === "DONE") {
        setPending(status);
        setReason("");
        setLaborHours("");
        setQc({});
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
          notifySuccess(previousStatus, status);
        })
        .catch((err: unknown) => {
          setError(getErrorMessage(err, t("jobs_status_change_error_unknown")));
          toast.error(t("job_status_failed"));
        })
        .finally(() => setLoading(false));
    },
    [job.id, job.status, transitionStatus, onChanged, notifySuccess, t]
  );

  // Returns the validated labor hours for DONE, or null (error already set).
  const validateDonePanel = useCallback((): number | null => {
    const parsed = Number.parseFloat(laborHours);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setError(t("validations.labor_hours_positive"));
      return null;
    }
    if (QC_CHECK_ITEMS.some((item) => !qc[item])) {
      setError(t("validations.qc_checklist_required"));
      return null;
    }
    return parsed;
  }, [laborHours, qc, t]);

  const handleConfirmReason = useCallback(async () => {
    if (!pending) {
      return;
    }
    if (REQUIRES_REASON.includes(pending) && !reason.trim()) {
      setError(t("validations.reason_required"));
      return;
    }
    let hours: number | undefined;
    if (pending === "DONE") {
      const validated = validateDonePanel();
      if (validated === null) {
        return;
      }
      hours = validated;
    }
    setLoading(true);
    setError(null);
    const previousStatus = job.status;
    try {
      await transitionStatus(
        job.id,
        pending,
        reason.trim() || undefined,
        hours,
        pending === "DONE" ? qc : undefined
      );
      setOpen(false);
      setPending(null);
      setReason("");
      onChanged?.();
      notifySuccess(previousStatus, pending);
    } catch (err: unknown) {
      setError(getErrorMessage(err, t("jobs_status_change_error_unknown")));
      toast.error(t("job_status_failed"));
    } finally {
      setLoading(false);
    }
  }, [
    pending,
    reason,
    qc,
    job.id,
    job.status,
    transitionStatus,
    onChanged,
    notifySuccess,
    validateDonePanel,
    t,
  ]);

  const handleCancelReason = useCallback(() => {
    setPending(null);
    setReason("");
    setLaborHours("");
    setQc({});
    setError(null);
  }, []);

  useEffect(() => {
    if (open && !pending) {
      listRef.current?.focus();
    }
  }, [open, pending]);

  useModalEffects(donePanel, handleCancelReason, qcDialogRef);

  const handleDelivered = useCallback(() => {
    const previousStatus = job.status;
    setDelivering(false);
    onChanged?.();
    notifySuccess(previousStatus, "DELIVERED");
  }, [job.status, onChanged, notifySuccess]);

  if (availableStatuses.length === 0) {
    return <StatusBadge size="md" status={job.status} />;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex min-h-11 items-center gap-1.5 rounded-full transition-colors hover:brightness-95 sm:min-h-0"
        onClick={() => {
          setOpen((prev) => !prev);
          setFocusedIndex(0);
        }}
        type="button"
      >
        <StatusBadge size="md" status={job.status} />
        <Icon
          className="text-base text-on-surface-variant"
          name={open ? "expand_less" : "expand_more"}
        />
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

          {pending && !donePanel && (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={job.status} />
                <Icon
                  className="text-on-surface-variant text-sm"
                  name="arrow_forward"
                />
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
                    <Icon
                      className="animate-spin text-sm"
                      name="progress_activity"
                    />
                  )}
                  {t("jobs_status_change_confirm")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {donePanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            aria-hidden="true"
            className="absolute inset-0 bg-overlay"
            disabled={loading}
            onClick={handleCancelReason}
            tabIndex={-1}
            type="button"
          />
          <div
            aria-labelledby="qc-dialog-title"
            aria-modal="true"
            className="modal-surface relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
            data-testid="qc-dialog"
            ref={qcDialogRef}
            role="dialog"
          >
            <header className="flex items-start gap-3 bg-surface-container-low px-6 py-5">
              <Icon
                className="mt-0.5 text-2xl text-primary"
                name="fact_check"
              />
              <div className="min-w-0 flex-1">
                <h2
                  className="font-bold font-headline text-lg text-on-surface"
                  id="qc-dialog-title"
                >
                  {t("qc_dialog.title")}
                </h2>
                <p className="font-label text-on-surface-variant text-xs">
                  {t("qc_dialog.subtitle", { code: job.jobCode })}
                </p>
              </div>
              <button
                aria-label={t("close")}
                className="flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
                disabled={loading}
                onClick={handleCancelReason}
                type="button"
              >
                <Icon className="text-xl" name="close" />
              </button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <label
                  className="mb-1 block font-label text-on-surface-variant text-xs"
                  htmlFor="labor-hours"
                >
                  {t("tech_dashboard.labor_hours_label")}
                </label>
                <input
                  className="w-full rounded-xl bg-surface-container-highest px-4 py-2.5 font-body text-on-surface text-sm"
                  id="labor-hours"
                  inputMode="decimal"
                  min="0.1"
                  onChange={(e) => setLaborHours(e.target.value)}
                  placeholder={t("tech_dashboard.labor_hours_placeholder")}
                  step="0.1"
                  type="number"
                  value={laborHours}
                />
              </div>
              <FunctionalChecklist
                hint={t("qc_dialog.checklist_hint")}
                legend={t("qc_dialog.checklist_legend")}
                onChange={setQc}
                t={t}
                value={qc}
              />
              {error && (
                <p className="font-body text-error text-sm" role="alert">
                  {error}
                </p>
              )}
            </div>
            <footer className="flex flex-col-reverse gap-2 border-outline-variant/30 border-t px-6 py-4 sm:flex-row sm:justify-end">
              <button
                className="min-h-[44px] rounded-xl px-4 py-2 font-bold font-headline text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high"
                disabled={loading}
                onClick={handleCancelReason}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl bg-primary px-4 py-2 font-bold font-headline text-on-primary text-sm transition-colors hover:bg-primary-container disabled:opacity-60"
                disabled={loading}
                onClick={handleConfirmReason}
                type="button"
              >
                {loading && (
                  <Icon
                    className="animate-spin text-sm"
                    name="progress_activity"
                  />
                )}
                {t("qc_dialog.confirm")}
              </button>
            </footer>
          </div>
        </div>
      )}

      <DeliverJobDialog
        balanceDue={balanceDue}
        job={job}
        onCancel={() => setDelivering(false)}
        onDelivered={handleDelivered}
        open={delivering}
      />
    </div>
  );
}
