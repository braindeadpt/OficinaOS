import { PAYMENT_METHODS } from "@shared/constants";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import type { ApiError } from "@/lib/api";
import { useJobsStore } from "@/stores/jobs";

interface AddPaymentDialogProps {
  balanceDue: number;
  jobId: string;
  onAdded: () => void;
  onClose: () => void;
  open: boolean;
}

export default function AddPaymentDialog({
  jobId,
  balanceDue,
  open,
  onClose,
  onAdded,
}: AddPaymentDialogProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMethod("CASH");
    setAmount(balanceDue > 0 ? String(balanceDue) : "");
    setReference("");
    setNote("");
    setSubmitError(null);
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, balanceDue]);

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
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await useJobsStore.getState().addPayment(jobId, {
        amount: parsedAmount,
        method,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      toast.success(t("payments.added_success"));
      onAdded();
      onClose();
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      if (apiErr.code === "PAYMENT_EXCEEDS_BALANCE") {
        setSubmitError(t("errors.payment_exceeds_balance"));
      } else {
        setSubmitError(t("jobs_status_change_error_unknown"));
      }
    } finally {
      setSubmitting(false);
    }
  }, [amount, jobId, method, note, onClose, onAdded, reference, t]);

  if (!open) {
    return null;
  }

  const parsedAmount = Number.parseFloat(amount);
  const canSubmit =
    !Number.isNaN(parsedAmount) && parsedAmount > 0 && !submitting;
  const remainingAfter =
    !Number.isNaN(parsedAmount) && parsedAmount > 0
      ? balanceDue - parsedAmount
      : balanceDue;

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
            {t("payments.add_payment")}
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
            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="payment-method"
              >
                {t("payments.method")}
              </label>
              <select
                className="h-12 w-full appearance-none rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
                id="payment-method"
                onChange={(e) => setMethod(e.target.value)}
                value={method}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`payment_method.${m}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="payment-amount"
              >
                {t("payments.amount")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
                id="payment-amount"
                inputMode="decimal"
                max={balanceDue}
                min="0.01"
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
              <p className="mt-1 font-label text-on-surface-variant text-xs">
                {t("payments.balance_due_label")}: {fmt(balanceDue)} ·{" "}
                {t("payments.remaining_after")}:{" "}
                {fmt(Math.max(0, remainingAfter))}
              </p>
            </div>

            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="payment-reference"
              >
                {t("payments.reference")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary"
                id="payment-reference"
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("payments.reference_placeholder")}
                type="text"
                value={reference}
              />
            </div>

            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="payment-note"
              >
                {t("payments.note")}
              </label>
              <textarea
                className="w-full rounded-xl bg-surface-container-highest px-4 py-3 text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary"
                id="payment-note"
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                value={note}
              />
            </div>
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
            {submitting ? "..." : t("payments.add_payment")}
          </button>
        </div>
      </div>
    </div>
  );
}
