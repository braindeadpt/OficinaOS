import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useModalEffects } from "@/hooks/use-modal-effects";
import i18n from "@/i18n";
import api, { getErrorMessage } from "@/lib/api";
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

  useEffect(() => {
    if (open) {
      setDescription("");
      setContact("");
      setError("");
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
      toast.error(getErrorMessage(err, t("report_problem.error")));
    } finally {
      setIsSubmitting(false);
    }
  }, [description, contact, onClose, t]);

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
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button onClick={onClose} type="button" variant="ghost">
            {t("report_problem.cancel")}
          </Button>
          <Button
            disabled={isSubmitting}
            loading={isSubmitting}
            onClick={handleSubmit}
            type="button"
          >
            {t("report_problem.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
