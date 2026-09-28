import type { Payment } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Can } from "@/components/modules/can";
import AddPaymentDialog from "@/components/modules/jobs/add-payment-dialog";
import { formatCurrency } from "@/lib/format";
import { useJobsStore } from "@/stores/jobs";

interface JobPaymentsSectionProps {
  balanceDue: number;
  jobId: string;
  onChanged: () => void;
}

export default function JobPaymentsSection({
  balanceDue,
  jobId,
  onChanged,
}: JobPaymentsSectionProps) {
  const { t } = useTranslation();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
            <span className="material-symbols-outlined text-[18px]">add</span>
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
          {formatCurrency(balanceDue)}
        </span>
      </div>

      {!isLoading && payments.length > 0 && (
        <ul className="mt-3 divide-y divide-outline-variant">
          {payments.map((p) => (
            <li className="flex items-center gap-3 py-2.5" key={p.id}>
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                payments
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-body font-semibold text-on-surface text-sm">
                  {formatCurrency(Number(p.amount))} ·{" "}
                  {t(`payment_method.${p.method}`)}
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
                <button
                  aria-label={t("payments.remove")}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-outline hover:bg-surface-container-high hover:text-error"
                  onClick={() => handleRemove(p.id)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    delete
                  </span>
                </button>
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
