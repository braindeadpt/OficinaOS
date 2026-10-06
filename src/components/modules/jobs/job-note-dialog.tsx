import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const canSubmit = note.trim().length > 0;

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
    <Dialog
      actions={
        <>
          <Button
            disabled={submitting}
            onClick={onClose}
            type="button"
            variant="secondary"
          >
            {t("job_note_dialog_cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            loading={submitting}
            onClick={handleSubmit}
            type="button"
          >
            {t("job_note_dialog_submit")}
          </Button>
        </>
      }
      // Typed text is never thrown away by Escape or a stray backdrop click.
      dismissible={note.trim().length === 0}
      onClose={onClose}
      open={open}
      size="sm"
      title={t("job_note_dialog_title")}
    >
      <Textarea
        aria-label={t("job_note_dialog_title")}
        disabled={submitting}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("job_note_dialog_placeholder")}
        rows={3}
        value={note}
      />
      <div className="mt-1 text-end font-label text-on-surface-variant text-xs tabular-nums">
        {note.length}/500
      </div>
      {error && <p className="mt-2 text-danger text-xs">{error}</p>}
    </Dialog>
  );
}
