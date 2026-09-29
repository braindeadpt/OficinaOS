import { useTranslation } from "react-i18next";
import { Can } from "@/components/modules/can";
import { formatCurrency } from "@/lib/format";

function fmt(n: number): string {
  return formatCurrency(n);
}

interface CostSummaryProps {
  balanceDue?: number;
  deposit: number;
  finalCost: number;
  margin?: number;
  paidTotal?: number;
  partsTotal: number;
  repairsTotal: number;
}

export default function CostSummary({
  deposit,
  finalCost,
  partsTotal,
  repairsTotal,
  margin,
  paidTotal,
  balanceDue,
}: CostSummaryProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-surface-container p-6">
      <h2 className="mb-5 font-bold font-headline text-base text-on-surface">
        {t("jobs_detail_cost_summary")}
      </h2>
      <div className="space-y-3">
        <Can perm={{ parts: ["viewCost"] }}>
          <div className="flex items-baseline justify-between">
            <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("jobs_detail_parts_subtotal")}
            </span>
            <span className="font-body font-medium text-on-surface text-sm">
              {fmt(partsTotal)}
            </span>
          </div>
        </Can>
        <div className="flex items-baseline justify-between">
          <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
            {t("jobs_detail_repairs_subtotal")}
          </span>
          <span className="font-body font-medium text-on-surface text-sm">
            {fmt(repairsTotal)}
          </span>
        </div>
        {deposit > 0 && (
          <div className="flex items-baseline justify-between">
            <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("jobs_detail_deposit")}
            </span>
            <span className="font-body font-medium text-on-surface text-sm">
              -{fmt(deposit)}
            </span>
          </div>
        )}
        <div className="mt-5 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("jobs_detail_final_cost")}
            </span>
            <span className="font-extrabold font-headline text-2xl text-primary tracking-tight">
              {fmt(finalCost)}
            </span>
          </div>
        </div>
        {paidTotal !== undefined && paidTotal > 0 && (
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("payments.paid_total")}
            </span>
            <span className="font-body font-medium text-primary text-sm">
              -{fmt(paidTotal)}
            </span>
          </div>
        )}
        {balanceDue !== undefined && (
          <div className="mt-2 flex items-baseline justify-between">
            <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("payments.balance_due")}
            </span>
            <span
              className={`font-extrabold font-headline text-lg tracking-tight ${
                balanceDue > 0 ? "text-error" : "text-primary"
              }`}
            >
              {fmt(balanceDue)}
            </span>
          </div>
        )}
        {margin !== undefined && (
          <div className="mt-5 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
                {t("jobs_detail_margin")}
              </span>
              <span
                className={`font-extrabold font-headline text-lg tracking-tight ${margin >= 0 ? "text-primary" : "text-error"}`}
              >
                {margin >= 0 ? "+" : ""}
                {fmt(margin)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
