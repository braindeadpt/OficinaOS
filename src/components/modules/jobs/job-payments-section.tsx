import { PAYMENT_METHODS } from "@shared/constants";
import type { Payment } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Can } from "@/components/modules/can";
import AddPaymentDialog from "@/components/modules/jobs/add-payment-dialog";
import { Icon } from "@/components/ui/icon";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { fetchInvoicingStatus, issueJobInvoice } from "@/lib/api-invoicing";
import { useJobsStore } from "@/stores/jobs";

const POD_METHODS = PAYMENT_METHODS;
const POD_HIDDEN_STATUSES = new Set([
  "DONE",
  "DELIVERED",
  "CANCELLED",
  "RETURNED",
]);

interface JobPaymentsSectionProps {
  balanceDue: number;
  invoiced: boolean;
  invoiceNumber: string | null;
  invoicePermalink: string | null;
  jobId: string;
  onChanged: () => void;
  paymentOnDeliveryMethod: string | null;
  status: string;
}

export default function JobPaymentsSection({
  balanceDue,
  invoiceNumber,
  invoicePermalink,
  invoiced,
  jobId,
  onChanged,
  paymentOnDeliveryMethod,
  status,
}: JobPaymentsSectionProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [podMethod, setPodMethod] = useState<string>("CASH");
  const [podBusy, setPodBusy] = useState(false);
  const [podError, setPodError] = useState<string | undefined>();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [invoicingReady, setInvoicingReady] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoicingStatus()
      .then((s) => setInvoicingReady(s.enabled && s.module))
      .catch(() => setInvoicingReady(false));
  }, []);

  const fetchPayments = useCallback(async () => {
    try {
      const result = await useJobsStore.getState().fetchPayments(jobId);
      setPayments(result.payments);
    } catch {
      // Section stays empty; job detail already surfaces global errors.
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleRemove = useCallback(
    async (paymentId: string) => {
      try {
        await useJobsStore.getState().removePayment(jobId, paymentId);
        await fetchPayments();
        onChanged();
      } catch {
        // Store already set the error; nothing else to do here.
      }
    },
    [jobId, fetchPayments, onChanged]
  );

  const handleAdded = useCallback(async () => {
    await fetchPayments();
    onChanged();
  }, [fetchPayments, onChanged]);

  const handleMarkPod = useCallback(async () => {
    setPodBusy(true);
    setPodError(undefined);
    try {
      await useJobsStore.getState().markPaymentOnDelivery(jobId, podMethod);
      onChanged();
    } catch (err: unknown) {
      setPodError(
        err instanceof Error
          ? err.message
          : t("errors.mark_payment_on_delivery")
      );
    } finally {
      setPodBusy(false);
    }
  }, [jobId, podMethod, onChanged, t]);

  const handleUnmarkPod = useCallback(async () => {
    setPodBusy(true);
    setPodError(undefined);
    try {
      await useJobsStore.getState().clearPaymentOnDelivery(jobId);
      onChanged();
    } catch (err: unknown) {
      setPodError(
        err instanceof Error
          ? err.message
          : t("errors.clear_payment_on_delivery")
      );
    } finally {
      setPodBusy(false);
    }
  }, [jobId, onChanged, t]);

  const handleIssueInvoice = useCallback(async () => {
    setInvoiceBusy(true);
    setInvoiceError(null);
    try {
      await issueJobInvoice(jobId);
      onChanged();
    } catch {
      setInvoiceError(t("payments.invoice_failed"));
    } finally {
      setInvoiceBusy(false);
    }
  }, [jobId, onChanged, t]);

  const canMarkPod =
    !paymentOnDeliveryMethod &&
    balanceDue > 0 &&
    !POD_HIDDEN_STATUSES.has(status);

  // A fiscal document makes sense once the repair is finished/delivered —
  // before that the final amount is not settled.
  const canInvoice =
    invoicingReady && !invoiced && ["DONE", "DELIVERED"].includes(status);

  const showMarkedBanner =
    !!paymentOnDeliveryMethod && !["CANCELLED", "RETURNED"].includes(status);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-bold font-headline text-base text-on-surface">
          {t("payments.section_title")}
        </h2>
        <Can perm={{ payments: ["create"] }}>
          <button
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-primary transition-colors hover:bg-primary/10"
            onClick={() => setShowAddDialog(true)}
            type="button"
          >
            <Icon className="text-[18px]" name="add" />
            <span className="font-label text-xs">
              {t("payments.add_payment")}
            </span>
          </button>
        </Can>
      </div>

      <div className="mt-3 flex items-baseline justify-between rounded-xl bg-surface-container-high px-4 py-3">
        <span className="font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide">
          {t("payments.balance_due")}
        </span>
        <span
          className={`font-extrabold font-headline text-lg ${balanceDue > 0 ? "text-error" : "text-primary"}`}
        >
          {fmt(balanceDue)}
        </span>
      </div>

      {showMarkedBanner && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-primary-container px-4 py-3">
          <Icon className="text-[18px] text-on-primary-container" name="bolt" />
          <span className="flex-1 font-body font-semibold text-on-primary-container text-sm">
            {t("payments.pod_marked", {
              amount: fmt(balanceDue),
              method: t(`payment_method.${paymentOnDeliveryMethod}`),
            })}
          </span>
          {balanceDue > 0 && (
            <button
              className="min-h-[36px] rounded-lg bg-surface-container-lowest px-3 font-bold text-primary text-xs transition-colors hover:bg-surface-container-low"
              onClick={() => setShowAddDialog(true)}
              type="button"
            >
              {t("payments.pod_record_now")}
            </button>
          )}
          <Can perm={{ payments: ["delete"] }}>
            <button
              className="min-h-[36px] rounded-lg px-3 font-bold text-error text-xs transition-colors hover:bg-error/10"
              disabled={podBusy}
              onClick={handleUnmarkPod}
              type="button"
            >
              {t("payments.pod_cancel")}
            </button>
          </Can>
        </div>
      )}

      <Can perm={{ payments: ["create"] }}>
        {canMarkPod && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-container/40 px-4 py-3">
            <Icon className="text-[18px] text-primary" name="bolt" />
            <span className="flex-1 font-body text-on-surface text-sm">
              {t("payments.pod_hint")}
            </span>
            <select
              aria-label={t("payments.pod_method_label")}
              className="min-h-[36px] rounded-lg border border-outline-variant bg-surface-container-lowest px-2 text-on-surface text-sm"
              onChange={(e) => setPodMethod(e.target.value)}
              value={podMethod}
            >
              {POD_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`payment_method.${m}`)}
                </option>
              ))}
            </select>
            <button
              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-primary px-3 font-bold text-on-primary text-xs transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={podBusy}
              onClick={handleMarkPod}
              type="button"
            >
              <Icon className="text-[16px]" name="how_to_reg" />
              {t("payments.pod_mark")}
            </button>
          </div>
        )}
      </Can>

      {invoiced && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-container-high px-4 py-3">
          <Icon
            className="text-[18px] text-on-surface-variant"
            name="receipt_long"
          />
          <span className="flex-1 font-body font-semibold text-on-surface text-sm">
            {t("payments.invoice_issued", {
              number: invoiceNumber ?? "—",
            })}
          </span>
          {invoicePermalink && (
            <a
              className="min-h-[36px] rounded-lg px-3 py-2 font-bold text-primary text-xs transition-colors hover:bg-primary/10"
              href={invoicePermalink}
              rel="noreferrer"
              target="_blank"
            >
              {t("payments.invoice_open")}
            </a>
          )}
        </div>
      )}

      <Can perm={{ payments: ["create"] }}>
        {canInvoice && (
          <button
            className="mt-3 inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-primary/30 bg-primary-container/40 px-3 font-bold text-primary text-xs transition-colors hover:bg-primary-container/60 disabled:opacity-50"
            disabled={invoiceBusy}
            onClick={handleIssueInvoice}
            type="button"
          >
            <Icon className="text-[16px]" name="receipt_long" />
            {t("payments.issue_invoice")}
          </button>
        )}
      </Can>

      {invoiceError && (
        <p className="mt-2 font-label text-error text-xs">{invoiceError}</p>
      )}

      {podError && (
        <p className="mt-2 font-label text-error text-xs">{podError}</p>
      )}

      {!isLoading && payments.length > 0 && (
        <ul className="mt-3 divide-y divide-outline-variant">
          {payments.map((p) => (
            <li className="flex items-center gap-3 py-2.5" key={p.id}>
              <Icon
                className="text-[18px] text-on-surface-variant"
                name={p.method === "CASH" ? "local_atm" : "payments"}
              />
              <div className="min-w-0 flex-1">
                <p className="font-body font-semibold text-on-surface text-sm">
                  {fmt(Number(p.amount))} · {t(`payment_method.${p.method}`)}
                </p>
                {p.reference && (
                  <p className="truncate font-label text-on-surface-variant text-xs">
                    {p.reference}
                  </p>
                )}
              </div>
              <span className="font-label text-on-surface-variant text-xs">
                {new Date(p.createdAt).toLocaleDateString()}
              </span>
              <Can perm={{ payments: ["delete"] }}>
                {confirmingId === p.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      aria-label={t("confirm")}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-error text-on-error transition-colors"
                      onClick={() => {
                        setConfirmingId(null);
                        handleRemove(p.id);
                      }}
                      type="button"
                    >
                      <Icon className="text-sm" name="check" />
                    </button>
                    <button
                      aria-label={t("cancel")}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high"
                      onClick={() => setConfirmingId(null)}
                      type="button"
                    >
                      <Icon className="text-sm" name="close" />
                    </button>
                  </span>
                ) : (
                  <button
                    aria-label={t("payments.remove")}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container-high hover:text-error"
                    onClick={() => setConfirmingId(p.id)}
                    type="button"
                  >
                    <Icon className="text-[18px]" name="delete" />
                  </button>
                )}
              </Can>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && payments.length === 0 && (
        <p className="mt-2 font-body text-on-surface-variant text-sm">
          {t("payments.empty")}
        </p>
      )}

      <AddPaymentDialog
        balanceDue={balanceDue}
        jobId={jobId}
        onAdded={handleAdded}
        onClose={() => setShowAddDialog(false)}
        open={showAddDialog}
      />
    </div>
  );
}
