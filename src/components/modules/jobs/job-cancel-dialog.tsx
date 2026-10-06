import type { Job } from "@shared/types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useJobsStore } from "@/stores/jobs";

interface JobCancelDialogProps {
  job: Job;
  onClose: () => void;
  open: boolean;
}

export default function JobCancelDialog({
  open,
  job,
  onClose,
}: JobCancelDialogProps) {
  const { t } = useTranslation();
  const transitionStatus = useJobsStore((s) => s.transitionStatus);
  const jobId = job.id;
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (reason.trim().length > 0) {
          return;
        }
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, reason]);

  if (!open) {
    return null;
  }

  const canSubmit = reason.trim().length > 0;
  const isFormDirty = reason.trim().length > 0;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await transitionStatus(jobId, "CANCELLED", reason.trim());
      onClose();
      // CANCELLED is terminal — JOB_STATUS_FLOW has no path back, so the
      // undo action is only offered when the transition is reversible.
      toast(t("job_cancel_success"), { duration: 5000 });
    } catch {
      setError(t("job_actions_status_error"));
      toast.error(t("job_cancel_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={isFormDirty ? undefined : onClose}
        type="button"
      />
      <div className="modal-surface relative z-10 w-full max-w-md rounded-xl bg-surface-container-lowest p-6 shadow-2xl">
        <h2 className="mb-4 font-bold font-headline text-error text-lg">
          {t("job_cancel_dialog_title")}
        </h2>
        <label
          className="mb-1 block font-label text-on-surface-variant text-xs uppercase"
          htmlFor="cancel-reason"
        >
          {t("job_cancel_dialog_reason_label")}
        </label>
        <textarea
          className="w-full resize-none rounded-xl bg-surface-container-highest p-4 text-on-surface text-sm placeholder:text-outline"
          disabled={submitting}
          id="cancel-reason"
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("job_cancel_dialog_reason_placeholder")}
          rows={3}
          value={reason}
        />
        <div className="mt-1 text-end font-label text-on-surface-variant text-xs">
          {reason.length}/500
        </div>
        {error && <p className="mt-2 font-body text-error text-xs">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button
            className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm hover:text-on-surface"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            {t("job_cancel_dialog_go_back")}
          </button>
          <button
            className="rounded-xl bg-error px-6 py-2 font-bold font-headline text-on-error text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            type="button"
          >
            {t("job_cancel_dialog_submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
