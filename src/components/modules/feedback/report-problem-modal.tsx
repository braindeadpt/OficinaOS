import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useModalEffects } from "@/hooks/use-modal-effects";
import i18n from "@/i18n";
import api, { type ApiError, getErrorMessage } from "@/lib/api";
import { getRecentErrors } from "@/lib/error-buffer";

interface ReportProblemModalProps {
  onClose: () => void;
  open: boolean;
}

const MIN_DESCRIPTION = 10;

export default function ReportProblemModal({
  onClose,
  open,
}: ReportProblemModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(open, onClose, dialogRef);

  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription("");
      setContact("");
      setError("");
      setFallback(false);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (description.trim().length < MIN_DESCRIPTION) {
      setError(t("report_problem.error_description_required"));
      return;
    }
    setIsSubmitting(true);
    try {
      const { data } = await api.post("/feedback/report", {
        description: description.trim(),
        contact: contact.trim() || undefined,
        context: {
          url: window.location.pathname + window.location.search,
          userAgent: navigator.userAgent,
          locale: i18n.language,
          errors: getRecentErrors(),
        },
      });
      toast.success(t("report_problem.success", { number: data.issueNumber }));
      onClose();
    } catch (err) {
      // No GitHub token configured server-side — offer a manual copy instead
      // of a dead-end error toast.
      if ((err as ApiError).code === "FEEDBACK_NOT_CONFIGURED") {
        setFallback(true);
      } else {
        toast.error(getErrorMessage(err, t("report_problem.error")));
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [description, contact, onClose, t]);

  const handleCopyReport = useCallback(async () => {
    const errors = getRecentErrors();
    const report = [
      "[OficinaOS problem report]",
      `Page: ${window.location.pathname + window.location.search}`,
      `Locale: ${i18n.language}`,
      `User agent: ${navigator.userAgent}`,
      contact.trim() ? `Contact: ${contact.trim()}` : null,
      "",
      "Description:",
      description.trim(),
      errors.length > 0 ? `\nRecent errors:\n${errors.join("\n")}` : null,
    ]
      .filter((line) => line !== null)
      .join("\n");

    // LAN HTTP is not a secure context — navigator.clipboard may be
    // unavailable, so fall back to a temporary textarea + execCommand.
    let copied = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(report);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      const ta = document.createElement("textarea");
      ta.value = report;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand("copy");
      ta.remove();
    }
    if (copied) {
      toast.success(t("report_problem.report_copied"));
    } else {
      toast.error(t("report_problem.copy_error"));
    }
  }, [description, contact, t]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-labelledby="report-problem-title"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-on-surface"
        onClick={onClose}
        type="button"
      />
      <div
        className="modal-surface relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-b-none bg-surface-container-lowest shadow-2xl sm:max-h-[80vh] sm:max-w-md sm:rounded-xl"
        ref={dialogRef}
      >
        <div className="flex items-center justify-between px-6 py-4">
          <h2
            className="font-bold font-headline text-lg text-on-surface"
            id="report-problem-title"
          >
            {t("report_problem.title")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <Label htmlFor="report-problem-description">
              {t("report_problem.description_label")}
            </Label>
            <Textarea
              id="report-problem-description"
              onChange={(e) => {
                setDescription(e.target.value);
                setError("");
              }}
              placeholder={t("report_problem.description_placeholder")}
              rows={4}
              value={description}
            />
            {error && <p className="ms-1 mt-1 text-error text-xs">{error}</p>}
          </div>

          <div>
            <Label htmlFor="report-problem-contact">
              {t("report_problem.contact_label")}
            </Label>
            <Input
              id="report-problem-contact"
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("report_problem.contact_placeholder")}
              value={contact}
            />
          </div>

          <p className="rounded-lg bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
            {t("report_problem.auto_attach")}
          </p>

          {fallback && (
            <p
              className="rounded-lg bg-tertiary-container/30 px-3 py-2 text-on-surface text-xs"
              role="status"
            >
              {t("report_problem.not_configured")}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button onClick={onClose} type="button" variant="ghost">
            {t("report_problem.cancel")}
          </Button>
          {fallback ? (
            <Button onClick={handleCopyReport} type="button">
              {t("report_problem.copy_report")}
            </Button>
          ) : (
            <Button
              disabled={isSubmitting}
              loading={isSubmitting}
              onClick={handleSubmit}
              type="button"
            >
              {t("report_problem.submit")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
