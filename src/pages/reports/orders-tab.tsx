import { useTranslation } from "react-i18next";
import { MetricCard } from "@/components/ui/metric-card";
import { downloadCsv } from "@/lib/export-csv";
import { useReportsStore } from "@/stores/reports";

const STATUSES = [
  "INTAKE",
  "WAITING_FOR_PARTS",
  "IN_REPAIR",
  "ON_HOLD",
  "DONE",
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
] as const;

export default function OrdersTab() {
  const { t } = useTranslation();
  const state = useReportsStore((s) => s.orders);
  const status = useReportsStore((s) => s.ordersStatus);
  const setStatus = useReportsStore((s) => s.setOrdersStatus);
  const fetchOrders = useReportsStore((s) => s.fetchOrders);
  const range = useReportsStore((s) => s.range);
  const customFrom = useReportsStore((s) => s.customFrom);
  const customTo = useReportsStore((s) => s.customTo);

  const base =
    customFrom && customTo
      ? `from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}`
      : `range=${range}`;
  const pdfUrl = `/api/reports/orders/pdf?${base}${status ? `&status=${status}` : ""}`;

  const exportCsv = () => {
    const data = useReportsStore.getState().orders.data;
    if (!data) {
      return;
    }
    const showMargin = data.summary.avgMargin !== undefined;
    const fmtDate = (iso: string | undefined) =>
      iso ? new Date(iso).toLocaleDateString() : "";
    downloadCsv(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        t("reports.jobCode"),
        t("reports.customer"),
        t("reports.device"),
        t("status_label"),
        t("reports.orders_value"),
        ...(showMargin ? [t("reports.margin")] : []),
        t("reports.orders_date_in"),
        t("reports.orders_date_out"),
      ],
      data.rows.map((r) => [
        r.jobCode,
        r.customerName,
        r.deviceName,
        t(`status.${r.status}`),
        r.totalValue,
        ...(showMargin ? [r.margin ?? ""] : []),
        fmtDate(r.createdAt),
        fmtDate(r.completedAt),
      ])
    );
  };

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="min-h-11 rounded-xl bg-surface-container-low px-3 text-on-surface text-sm"
        onChange={(e) => {
          const v = e.target.value || undefined;
          setStatus(v);
          fetchOrders(v);
        }}
        value={status ?? ""}
      >
        <option value="">{t("reports.orders_all_statuses")}</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>
      <a
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-medium text-on-primary text-sm transition-opacity hover:opacity-90"
        href={pdfUrl}
        rel="noreferrer"
        target="_blank"
      >
        <span className="material-symbols-outlined text-[18px]">
          picture_as_pdf
        </span>
        {t("reports.orders_generate_pdf")}
      </a>
      <button
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-surface-container-high px-4 font-medium text-on-surface text-sm transition-colors hover:bg-surface-container-highest disabled:opacity-50"
        disabled={!state.data || state.data.rows.length === 0}
        onClick={exportCsv}
        type="button"
      >
        <span className="material-symbols-outlined text-[18px]">download</span>
        {t("reports.export_csv")}
      </button>
    </div>
  );

  if (state.loading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="py-12 text-center text-on-surface-variant">
          {t("loading")}
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-6">
        {header}
        <div className="py-12 text-center text-error">{state.error}</div>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="space-y-6">
        {header}
        <div className="py-12 text-center text-on-surface-variant">
          {t("reports.noData")}
        </div>
      </div>
    );
  }

  const { summary, rows } = state.data;
  const showMargin = summary.avgMargin !== undefined;

  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          detail=""
          icon="list_alt"
          label={t("reports.orders_total")}
          value={`${summary.totalOrders}`}
        />
        <MetricCard
          detail=""
          icon="payments"
          label={t("reports.orders_total_value")}
          value={summary.totalValue.toLocaleString()}
        />
        <MetricCard
          detail=""
          icon="calculate"
          label={t("reports.orders_avg")}
          value={summary.avgOrderValue.toLocaleString()}
        />
        {showMargin && (
          <MetricCard
            detail="%"
            icon="trending_up"
            label={t("reports.orders_margin")}
            value={`${summary.avgMargin}%`}
          />
        )}
      </div>

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl bg-surface-container-low">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-outline-variant border-b text-on-surface-variant text-xs uppercase tracking-wide">
                <th className="px-4 py-3">{t("reports.jobCode")}</th>
                <th className="px-4 py-3">{t("reports.customer")}</th>
                <th className="px-4 py-3">{t("reports.device")}</th>
                <th className="px-4 py-3">{t("status_label")}</th>
                <th className="px-4 py-3 text-end">
                  {t("reports.orders_value")}
                </th>
                {showMargin && (
                  <th className="px-4 py-3 text-end">{t("reports.margin")}</th>
                )}
                <th className="px-4 py-3">{t("reports.orders_date_in")}</th>
                <th className="px-4 py-3">{t("reports.orders_date_out")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="border-outline-variant/50 border-b last:border-0"
                  key={row.jobCode}
                >
                  <td className="px-4 py-3 font-medium font-mono text-on-surface">
                    {row.jobCode}
                  </td>
                  <td className="px-4 py-3 text-on-surface">
                    {row.customerName}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {row.deviceName}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {t(`status.${row.status}`)}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {row.totalValue.toLocaleString()}
                  </td>
                  {showMargin && (
                    <td className="px-4 py-3 text-end tabular-nums">
                      {row.margin === undefined ? "—" : `${row.margin}%`}
                    </td>
                  )}
                  <td className="px-4 py-3 text-on-surface-variant">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {row.completedAt
                      ? new Date(row.completedAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-8 text-center text-on-surface-variant">
          {t("reports.noData")}
        </p>
      )}
    </div>
  );
}
