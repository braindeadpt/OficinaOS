import { PAYMENT_METHODS, type PaymentMethodType } from "@shared/constants";
import type { Job } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { getErrorMessage } from "@/lib/api";
import { printJobReceipt, usesThermalPrinter } from "@/lib/print";
import { useJobsStore } from "@/stores/jobs";

const AMOUNT_REGEX = /^\d*([.,]\d{0,2})?$/;

interface DeliverJobDialogProps {
  balanceDue: number;
  job: Pick<Job, "id" | "jobCode" | "status"> & {
    paymentOnDeliveryMethod?: string | null;
  };
  onCancel: () => void;
  /** Called after the job reached DELIVERED (payment, if any, already saved). */
  onDelivered: () => void;
  open: boolean;
}

function parseAmount(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

function isPaymentMethod(value: unknown): value is PaymentMethodType {
  return (
    typeof value === "string" && (PAYMENT_METHODS as string[]).includes(value)
  );
}

/** Returns the i18n key of the first problem, or null when it can go ahead. */
function validateDelivery(input: {
  acknowledgeUnpaid: boolean;
  balanceDue: number;
  needsAcknowledgement: boolean;
  parsedAmount: number;
  paying: boolean;
}): string | null {
  const { acknowledgeUnpaid, balanceDue, needsAcknowledgement, parsedAmount } =
    input;
  if (input.paying) {
    if (!(Number.isFinite(parsedAmount) && parsedAmount > 0)) {
      return "validations.valid_payment_amount";
    }
    if (parsedAmount > balanceDue + 0.001) {
      return "errors.payment_exceeds_balance";
    }
  }
  if (needsAcknowledgement && !acknowledgeUnpaid) {
    return "deliver_dialog.ack_required";
  }
  return null;
}

/**
 * Delivery is the one irreversible status change (DELIVERED has no way back),
 * so it always goes through this confirmation: what is still owed, how it is
 * being paid (MB WAY, Multibanco, numerário, cartão, transferência…), the
 * payment recorded in the same step, and an optional receipt/warranty print.
 * Handing a device over with money owed needs an explicit acknowledgement.
 */
export default function DeliverJobDialog({
  balanceDue,
  job,
  onCancel,
  onDelivered,
  open,
}: DeliverJobDialogProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const dialogRef = useRef<HTMLDivElement>(null);
  const transitionStatus = useJobsStore((s) => s.transitionStatus);
  const addPayment = useJobsStore((s) => s.addPayment);

  const owes = balanceDue > 0;
  const [recordPayment, setRecordPayment] = useState(owes);
  const [method, setMethod] = useState<PaymentMethodType>("CASH");
  const [amount, setAmount] = useState("");
  const [acknowledgeUnpaid, setAcknowledgeUnpaid] = useState(false);
  const [printReceipt, setPrintReceipt] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setRecordPayment(balanceDue > 0);
    setMethod(
      isPaymentMethod(job.paymentOnDeliveryMethod)
        ? job.paymentOnDeliveryMethod
        : "CASH"
    );
    setAmount(balanceDue > 0 ? balanceDue.toFixed(2) : "");
    setAcknowledgeUnpaid(false);
    setPrintReceipt(true);
    setError(null);
  }, [open, balanceDue, job.paymentOnDeliveryMethod]);

  const close = useCallback(() => {
    if (!submitting) {
      onCancel();
    }
  }, [onCancel, submitting]);

  useModalEffects(open, close, dialogRef);

  const parsedAmount = parseAmount(amount);
  const paying = owes && recordPayment;
  const payingAmount =
    paying && Number.isFinite(parsedAmount) && parsedAmount > 0
      ? parsedAmount
      : 0;
  const remaining = Math.max(
    0,
    Math.round((balanceDue - payingAmount) * 100) / 100
  );
  // A balance set to be charged on delivery is settled by the server.
  const settledOnDelivery =
    owes && !paying && isPaymentMethod(job.paymentOnDeliveryMethod);
  const needsAcknowledgement = remaining > 0 && !settledOnDelivery;

  const handleConfirm = useCallback(async () => {
    const validationError = validateDelivery({
      acknowledgeUnpaid,
      balanceDue,
      needsAcknowledgement,
      parsedAmount,
      paying,
    });
    setError(validationError ? t(validationError) : null);
    if (validationError) {
      return;
    }

    // Open the print tab synchronously, while the click still counts as a
    // user gesture — a window.open after the awaits below is popup-blocked.
    const browserPrint = printReceipt && !usesThermalPrinter();
    const printWindow = browserPrint ? window.open("", "_blank") : null;

    setSubmitting(true);
    try {
      if (paying) {
        await addPayment(job.id, { amount: parsedAmount, method });
      }
      await transitionStatus(job.id, "DELIVERED");
    } catch (err: unknown) {
      printWindow?.close();
      setError(getErrorMessage(err, t("jobs_status_change_error_unknown")));
      setSubmitting(false);
      return;
    }

    if (printWindow) {
      printWindow.location.href = `/api/receipts/${job.id}/receipt`;
    } else if (printReceipt) {
      printJobReceipt(job.id);
    }
    setSubmitting(false);
    onDelivered();
  }, [
    acknowledgeUnpaid,
    addPayment,
    balanceDue,
    job.id,
    method,
    needsAcknowledgement,
    onDelivered,
    parsedAmount,
    paying,
    printReceipt,
    t,
    transitionStatus,
  ]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-hidden="true"
        className="absolute inset-0 bg-overlay"
        onClick={close}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby="deliver-dialog-title"
        aria-modal="true"
        className="modal-surface relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex items-start gap-3 bg-surface-container-low px-6 py-5">
          <span className="material-symbols-outlined mt-0.5 text-2xl text-primary">
            local_shipping
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="font-bold font-headline text-lg text-on-surface"
              id="deliver-dialog-title"
            >
              {t("deliver_dialog.title")}
            </h2>
            <p className="font-label text-on-surface-variant text-xs">
              {t("deliver_dialog.subtitle", { code: job.jobCode })}
            </p>
          </div>
          <button
            aria-label={t("close")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            disabled={submitting}
            onClick={close}
            type="button"
          >
            <Icon name="close" size="sm" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div
            className={`flex items-center justify-between rounded-xl px-4 py-3 ${
              owes ? "bg-error-container/50" : "bg-surface-container"
            }`}
            data-testid="deliver-balance"
          >
            <span className="font-label text-on-surface-variant text-sm">
              {t("deliver_dialog.balance_due")}
            </span>
            <span
              className={`font-bold font-headline text-xl ${
                owes ? "text-on-error-container" : "text-on-surface"
              }`}
            >
              {fmt(balanceDue)}
            </span>
          </div>

          {owes && (
            <div className="space-y-4">
              <Field horizontal label={t("deliver_dialog.record_payment")}>
                <Checkbox
                  checked={recordPayment}
                  onChange={(e) => setRecordPayment(e.target.checked)}
                />
              </Field>
              {recordPayment && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t("payments.method")}>
                    <Select
                      onChange={(e) =>
                        setMethod(e.target.value as PaymentMethodType)
                      }
                      value={method}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`payment_method.${m}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t("deliver_dialog.amount")}>
                    <Input
                      inputMode="decimal"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || AMOUNT_REGEX.test(v)) {
                          setAmount(v);
                        }
                      }}
                      value={amount}
                    />
                  </Field>
                </div>
              )}
              {settledOnDelivery && (
                <p className="font-body text-on-surface-variant text-xs">
                  {t("deliver_dialog.settled_on_delivery", {
                    method: t(`payment_method.${job.paymentOnDeliveryMethod}`),
                  })}
                </p>
              )}
              {needsAcknowledgement && (
                <div className="rounded-xl bg-error-container/40 px-4 py-2">
                  <Field
                    horizontal
                    label={t("deliver_dialog.ack_unpaid", {
                      amount: fmt(remaining),
                    })}
                  >
                    <Checkbox
                      checked={acknowledgeUnpaid}
                      onChange={(e) => setAcknowledgeUnpaid(e.target.checked)}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          <Field horizontal label={t("deliver_dialog.print_receipt")}>
            <Checkbox
              checked={printReceipt}
              onChange={(e) => setPrintReceipt(e.target.checked)}
            />
          </Field>

          <p className="flex items-start gap-2 font-body text-on-surface-variant text-xs leading-snug">
            <Icon name="info" size="xs" />
            {t("deliver_dialog.irreversible")}
          </p>

          {error && (
            <p className="font-body text-error text-sm" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-outline-variant/30 border-t px-6 py-4 sm:flex-row sm:justify-end">
          <Button
            disabled={submitting}
            onClick={close}
            type="button"
            variant="secondary"
          >
            {t("cancel")}
          </Button>
          <Button
            icon="check_circle"
            loading={submitting}
            onClick={handleConfirm}
            type="button"
          >
            {paying && payingAmount > 0
              ? t("deliver_dialog.confirm_with_payment", {
                  amount: fmt(payingAmount),
                })
              : t("deliver_dialog.confirm")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
