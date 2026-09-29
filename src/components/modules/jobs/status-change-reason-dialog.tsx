import type { JobStatusType } from "@shared/constants";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface StatusChangeReasonDialogProps {
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  open: boolean;
  status: JobStatusType;
}

export default function StatusChangeReasonDialog({
  open,
  status,
  onConfirm,
  onCancel,
}: StatusChangeReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
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
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  const canSubmit = reason.trim().length > 0;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-on-surface/40"
        onClick={onCancel}
        type="button"
      />
      <div className="modal-surface relative z-10 w-full max-w-md rounded-xl bg-surface-container-lowest p-6 shadow-2xl">
        <h2 className="mb-4 font-bold font-headline text-lg text-on-surface">
          {t("jobs_status_change_reason_title", {
            status: t(`status.${status}`),
          })}
        </h2>
        <textarea
          className="w-full resize-none rounded-xl bg-surface-container-highest p-4 text-on-surface text-sm placeholder:text-outline"
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("jobs_status_change_reason_placeholder")}
          rows={3}
          value={reason}
        />
        <div className="mt-1 text-end font-label text-on-surface-variant text-xs">
          {reason.length}/500
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm hover:text-on-surface"
            onClick={onCancel}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => onConfirm(reason.trim())}
            type="button"
          >
            {t("jobs_status_change_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
