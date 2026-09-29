import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import CashCloseCard from "@/components/reports/cash-close-card";
import CashClosedCard from "@/components/reports/cash-closed-card";
import { MetricCard } from "@/components/ui/metric-card";
import { useReportsStore } from "@/stores/reports";

function methodKey(method: string): string {
  return `payment_method.${method}`;
}

export default function CashTab() {
  const { t } = useTranslation();
  const state = useReportsStore((s) => s.cash);
  const sessionState = useReportsStore((s) => s.cashSession);
  const fetchCashSession = useReportsStore((s) => s.fetchCashSession);
  const reopenCashSession = useReportsStore((s) => s.reopenCashSession);

  useEffect(() => {
    fetchCashSession();
  }, [fetchCashSession]);

  const session = sessionState.data;

  if (state.loading) {
    return (
      <div className="py-12 text-center text-on-surface-variant">
        {t("loading")}
      </div>
    );
  }

  if (state.error) {
    return <div className="py-12 text-center text-error">{state.error}</div>;
  }

  if (!state.data) {
    return (
      <div className="py-12 text-center text-on-surface-variant">
        {t("reports.noData")}
      </div>
    );
  }

  const { byMethod, byUser, largestPayment, summary } = state.data;

  return (
    <div className="space-y-6">
      {session && session.status === "OPEN" && (
        <CashCloseCard
          key={session.id}
          onClosed={fetchCashSession}
          session={session}
        />
      )}
      {session && session.status === "CLOSED" && (
        <CashClosedCard onReopen={reopenCashSession} session={session} />
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          detail=""
          icon="payments"
          label={t("reports.cashTotalCollected")}
          value={summary.totalCollected.toLocaleString()}
        />
        <MetricCard
          detail=""
          icon="local_atm"
          label={t("reports.cashCashTotal")}
          value={summary.cashTotal.toLocaleString()}
        />
        <MetricCard
          detail=""
          icon="credit_card"
          label={t("reports.cashTransferTotal")}
          value={summary.transferTotal.toLocaleString()}
        />
        <MetricCard
          detail=""
          icon="receipt_long"
          label={t("reports.cashPaymentCount")}
          value={String(summary.paymentCount)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.cashByMethod")}
          </h2>
          {byMethod.length === 0 ? (
            <div className="rounded-xl bg-surface-container-low px-4 py-8 text-center text-on-surface-variant text-sm">
              {t("reports.cashEmpty")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl bg-surface-container-low">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                    <th className="px-4 py-3">{t("reports.cashMethod")}</th>
                    <th className="px-4 py-3 text-end">
                      {t("reports.cashPayments")}
                    </th>
                    <th className="px-4 py-3 text-end">
                      {t("reports.cashAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byMethod.map((m) => (
                    <tr
                      className="border-outline-variant/50 border-b last:border-0"
                      key={m.method}
                    >
                      <td className="px-4 py-3 font-medium text-on-surface">
                        {t(methodKey(m.method))}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums">
                        {m.count}
                      </td>
                      <td className="px-4 py-3 text-end font-bold tabular-nums">
                        {m.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 font-bold text-on-surface text-sm uppercase tracking-wide">
            {t("reports.cashByUser")}
          </h2>
          {byUser.length === 0 ? (
            <div className="rounded-xl bg-surface-container-low px-4 py-8 text-center text-on-surface-variant text-sm">
              {t("reports.cashEmpty")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl bg-surface-container-low">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                    <th className="px-4 py-3">{t("reports.cashUser")}</th>
                    <th className="px-4 py-3 text-end">
                      {t("reports.cashPayments")}
                    </th>
                    <th className="px-4 py-3 text-end">
                      {t("reports.cashAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byUser.map((u) => (
                    <tr
                      className="border-outline-variant/50 border-b last:border-0"
                      key={u.name}
                    >
                      <td className="px-4 py-3 font-medium text-on-surface">
                        {u.name}
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums">
                        {u.count}
                      </td>
                      <td className="px-4 py-3 text-end font-bold tabular-nums">
                        {u.total.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {largestPayment && (
        <p className="text-on-surface-variant text-sm">
          {t("reports.cashLargestPayment", {
            amount: largestPayment.amount.toLocaleString(),
            location:
              largestPayment.location === "POS"
                ? t("reports.cashLocationPos")
                : t("reports.cashLocationJob"),
            method: t(methodKey(largestPayment.method)),
            userName: largestPayment.userName,
          })}
        </p>
      )}
    </div>
  );
}
