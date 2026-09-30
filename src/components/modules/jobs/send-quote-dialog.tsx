import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useJobsStore } from "@/stores/jobs";

interface SendQuoteDialogProps {
  defaultAmount: number;
  jobId: string;
  onClose: () => void;
  onSent: () => void;
  open: boolean;
}

export default function SendQuoteDialog({
  defaultAmount,
  jobId,
  onClose,
  onSent,
  open,
}: SendQuoteDialogProps) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setAmount(String(defaultAmount));
    setNote("");
    setSubmitError(null);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, defaultAmount]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const parsedAmount = Number.parseFloat(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await useJobsStore.getState().sendQuote(jobId, {
        amount: parsedAmount,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t("quotes.sent_success"));
      onSent();
      onClose();
    } catch {
      setSubmitError(t("errors.send_quote"));
    } finally {
      setSubmitting(false);
    }
  }, [amount, jobId, note, onClose, onSent, t]);

  if (!open) {
    return null;
  }

  const parsedAmount = Number.parseFloat(amount);
  const canSubmit =
    !Number.isNaN(parsedAmount) && parsedAmount >= 0 && !submitting;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-on-surface/40"
        onClick={onClose}
        type="button"
      />
      <div className="modal-surface relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-outline-variant border-b px-6 py-4">
          <h2 className="font-bold font-headline text-lg text-on-surface">
            {t("quotes.send_title")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <p className="font-body text-on-surface-variant text-sm">
              {t("quotes.send_hint")}
            </p>
            <Field label={t("quotes.amount")} required>
              <Input
                inputMode="decimal"
                min="0"
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </Field>
            <Field hint={t("quotes.note_hint")} label={t("quotes.note_label")}>
              <Textarea
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                value={note}
              />
            </Field>
          </div>
        </div>

        {submitError && (
          <div
            className="border-outline-variant border-t px-6 py-2"
            role="alert"
          >
            <p className="font-body text-error text-xs">{submitError}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 border-outline-variant border-t px-6 py-4">
          <button
            className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm hover:text-on-surface"
            onClick={onClose}
            type="button"
          >
            {t("cancel")}
          </button>
          <button
            className="rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            {submitting ? "..." : t("quotes.send_submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
