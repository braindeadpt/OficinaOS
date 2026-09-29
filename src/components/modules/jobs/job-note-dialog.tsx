import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useJobsStore } from "@/stores/jobs";

interface JobNoteDialogProps {
  jobId: string;
  onClose: () => void;
  open: boolean;
}

export default function JobNoteDialog({
  open,
  jobId,
  onClose,
}: JobNoteDialogProps) {
  const { t } = useTranslation();
  const addNote = useJobsStore((s) => s.addNote);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNote("");
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
        if (note.trim().length > 0) {
          return;
        }
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, note]);

  if (!open) {
    return null;
  }

  const canSubmit = note.trim().length > 0;

  const handleBackdropClick = () => {
    if (note.trim().length > 0) {
      return;
    }
    onClose();
  };

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await addNote(jobId, note.trim());
      toast.success(t("job_note_success"));
      onClose();
    } catch {
      setError(t("job_actions_note_error"));
      toast.error(t("job_note_failed"));
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
        className="absolute inset-0 bg-on-surface/40"
        onClick={handleBackdropClick}
        type="button"
      />
      <div className="modal-surface relative z-10 w-full max-w-md rounded-xl bg-surface-container-lowest p-6 shadow-2xl">
        <h2 className="mb-4 font-bold font-headline text-lg text-on-surface">
          {t("job_note_dialog_title")}
        </h2>
        <textarea
          className="w-full resize-none rounded-xl bg-surface-container-highest p-4 text-on-surface text-sm placeholder:text-outline"
          disabled={submitting}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("job_note_dialog_placeholder")}
          rows={3}
          value={note}
        />
        <div className="mt-1 text-end font-label text-on-surface-variant text-xs">
          {note.length}/500
        </div>
        {error && <p className="mt-2 font-body text-error text-xs">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button
            className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm hover:text-on-surface"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            {t("job_note_dialog_cancel")}
          </button>
          <button
            className="rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            type="button"
          >
            {t("job_note_dialog_submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
