import type { JobStatusType } from "@shared/constants";
import { INACTIVE_STATUSES, JOB_STATUS_FLOW } from "@shared/constants";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { printJobReceipt } from "@/lib/print";
import { useJobsStore } from "@/stores/jobs";
import JobCancelDialog from "./job-cancel-dialog";
import JobNoteDialog from "./job-note-dialog";
import type { JobRow } from "./jobs-shared";

interface JobActionsMenuProps {
  job: JobRow;
}

export default function JobActionsMenu({ job }: JobActionsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const transitionStatus = useJobsStore((s) => s.transitionStatus);

  const isTerminal = INACTIVE_STATUSES.includes(job.status);
  const validTransitions: JobStatusType[] = isTerminal
    ? []
    : (JOB_STATUS_FLOW[job.status] ?? []);
  // CANCELLED goes through the cancel dialog; ON_HOLD/DONE need reason and
  // labor hours + QC, and DELIVERED needs the delivery dialog (balance,
  // payment, receipt) — the detail-page status popover collects those.
  const statusTransitions = validTransitions.filter(
    (s) =>
      s !== "CANCELLED" && s !== "ON_HOLD" && s !== "DONE" && s !== "DELIVERED"
  );
  const canCancel = validTransitions.includes("CANCELLED");
  const hasPhone = Boolean(job.rawJob?.customer?.phone);

  const close = useCallback(() => {
    setOpen(false);
    setMenuPos(null);
    setError(null);
  }, []);

  useLayoutEffect(() => {
    if (!(open && triggerRef.current)) {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuPos({ x: rect.right - 256, y: rect.bottom + 8 });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const handleStatusChange = useCallback(
    async (status: JobStatusType) => {
      setLoading(true);
      setError(null);
      try {
        await transitionStatus(job.rawJob?.id ?? job.id, status);
        toast.success(t("job_status_success"));
        close();
      } catch {
        setError(t("job_actions_status_error"));
        toast.error(t("job_status_failed"));
      } finally {
        setLoading(false);
      }
    },
    [job.rawJob?.id, job.id, transitionStatus, close, t]
  );

  const handleNoteOpen = useCallback(() => {
    setOpen(false);
    setNoteDialogOpen(true);
  }, []);

  const handleNoteClose = useCallback(() => {
    setNoteDialogOpen(false);
  }, []);

  const handleCancelOpen = useCallback(() => {
    setOpen(false);
    setCancelDialogOpen(true);
  }, []);

  const handleCancelClose = useCallback(() => {
    setCancelDialogOpen(false);
  }, []);

  if (isTerminal && !job.rawJob?.customer?.phone) {
    return null;
  }

  return (
    <>
      <div>
        <button
          aria-expanded={open}
          aria-haspopup="true"
          aria-label={t("job_actions")}
          className={`min-h-[44px] min-w-[44px] rounded-lg p-2 transition-colors hover:bg-surface-container-high hover:text-primary ${open ? "bg-primary-container text-on-primary" : "text-on-surface-variant"}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((prev) => !prev);
          }}
          ref={triggerRef}
          title={t("job_actions")}
          type="button"
        >
          <Icon name="more_vert" size="lg" />
        </button>
      </div>

      {open &&
        menuPos &&
        createPortal(
          <div
            className="fixed z-50 w-64 rounded-xl border border-outline-variant/20 bg-surface-container-lowest py-2 shadow-2xl"
            ref={menuRef}
            style={{ left: menuPos.x, top: menuPos.y }}
          >
            {statusTransitions.length > 0 && (
              <>
                <div className="px-3 py-2 font-bold font-label text-[10px] text-outline uppercase tracking-wider">
                  {t("job_actions_change_status")}
                </div>
                {statusTransitions.map((status) => (
                  <button
                    className="flex w-full items-center gap-3 px-4 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low disabled:opacity-50"
                    disabled={loading}
                    key={status}
                    onClick={() => handleStatusChange(status)}
                    type="button"
                  >
                    <Icon
                      className="text-lg text-primary"
                      name="arrow_forward"
                    />
                    <span>{t(`status.${status}`)}</span>
                  </button>
                ))}
                <div className="my-2 border-outline-variant/30 border-t" />
              </>
            )}

            {!isTerminal && (
              <button
                className="flex w-full items-center gap-3 px-4 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low"
                onClick={handleNoteOpen}
                type="button"
              >
                <Icon className="text-lg" name="sticky_note_2" />
                <span>{t("job_actions_add_note")}</span>
              </button>
            )}

            <a
              aria-disabled={!hasPhone}
              className={`flex w-full items-center gap-3 px-4 py-2 font-medium text-sm transition-colors ${hasPhone ? "cursor-pointer text-on-surface hover:bg-surface-container-low" : "cursor-not-allowed text-on-surface opacity-30"}`}
              href={hasPhone ? `tel:${job.rawJob?.customer?.phone}` : undefined}
              onClick={hasPhone ? () => close() : (e) => e.preventDefault()}
            >
              <Icon className="text-lg" name="call" />
              <span>{t("job_actions_call_customer")}</span>
            </a>

            <button
              className="flex w-full items-center gap-3 px-4 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low"
              onClick={() => {
                printJobReceipt(job.rawJob?.id ?? job.id);
                close();
              }}
              type="button"
            >
              <Icon className="text-lg" name="print" />
              <span>{t("job_actions_print_receipt")}</span>
            </button>
            <button
              className="flex w-full items-center gap-3 px-4 py-2 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-low"
              onClick={() => {
                window.open(
                  `/api/receipts/${job.rawJob?.id ?? job.id}/label`,
                  "_blank"
                );
                close();
              }}
              type="button"
            >
              <Icon className="text-lg" name="label" />
              <span>{t("job_actions_print_label")}</span>
            </button>

            {canCancel && (
              <>
                <div className="my-2 border-outline-variant/30 border-t" />
                <button
                  className="flex w-full items-center gap-3 px-4 py-2 font-bold text-error text-sm transition-colors hover:bg-error-container hover:text-on-error-container"
                  onClick={handleCancelOpen}
                  type="button"
                >
                  <Icon className="text-lg" name="close" />
                  <span>{t("job_actions_cancel_job")}</span>
                </button>
              </>
            )}

            {error && (
              <div className="border-outline-variant/30 border-t px-4 py-2">
                <p className="font-body text-error text-xs">{error}</p>
              </div>
            )}
          </div>,
          document.body
        )}

      {noteDialogOpen && job.rawJob?.id && (
        <JobNoteDialog
          jobId={job.rawJob.id}
          onClose={handleNoteClose}
          open={noteDialogOpen}
        />
      )}

      {cancelDialogOpen && job.rawJob && (
        <JobCancelDialog
          job={job.rawJob}
          onClose={handleCancelClose}
          open={cancelDialogOpen}
        />
      )}
    </>
  );
}
