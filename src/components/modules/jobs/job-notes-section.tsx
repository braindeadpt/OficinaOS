import type { Job } from "@shared/types";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";
import JobNoteDialog from "./job-note-dialog";

interface JobNotesSectionProps {
  job: Job;
  onChanged?: () => void;
}

export default function JobNotesSection({
  job,
  onChanged,
}: JobNotesSectionProps) {
  const { t } = useTranslation();
  const [showAddDialog, setShowAddDialog] = useState(false);

  const handleNoteClose = useCallback(() => {
    setShowAddDialog(false);
    onChanged?.();
  }, [onChanged]);

  const notes = job.notes ?? [];
  const hasNotes = notes.length > 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold font-headline text-base text-on-surface">
          {t("jobs_notes_title")}
        </h2>
      </div>

      {hasNotes ? (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              className="rounded-lg bg-surface-container-low px-3 py-2"
              key={note.id}
            >
              <p className="whitespace-pre-wrap font-body text-on-surface text-sm">
                {note.content}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-label text-on-surface-variant text-xs">
                  {note.createdBy?.name}
                </span>
                <span className="font-label text-on-surface-variant/60 text-xs">
                  {new Date(note.createdAt).toLocaleDateString()}
                </span>
                {note.isCustomerVisible && (
                  <span className="rounded bg-primary/10 px-1.5 font-label text-[10px] text-primary">
                    {t("job_note_visible")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-xl bg-surface-container-low/50 py-8">
          <Icon
            className="mb-2 text-3xl text-on-surface-variant/60"
            name="sticky_note_2"
          />
          <p className="font-bold font-headline text-on-surface-variant text-sm">
            {t("jobs_notes_empty")}
          </p>
        </div>
      )}

      <button
        className="mt-3 flex min-h-[44px] items-center gap-1 rounded-lg bg-surface-container-low px-3 font-bold font-label text-primary text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-high"
        onClick={() => setShowAddDialog(true)}
        type="button"
      >
        <Icon className="text-sm" name="add" />
        {t("job_actions_add_note")}
      </button>

      <JobNoteDialog
        jobId={job.id}
        onClose={handleNoteClose}
        open={showAddDialog}
      />
    </div>
  );
}
