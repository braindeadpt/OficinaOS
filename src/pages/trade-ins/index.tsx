import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import TradeInModal from "@/components/modules/trade-ins/trade-in-modal";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Icon } from "@/components/ui/icon";
import { useCan } from "@/hooks/use-can";
import {
  fetchTradeIns,
  type TradeIn,
  type TradeInListResponse,
  type TradeInStatus,
  transitionTradeIn,
} from "@/lib/api-trade-ins";
import { formatCurrency } from "@/lib/format";

const PAGE_SIZE = 20;
const STATUSES: TradeInStatus[] = ["OFFERED", "PURCHASED", "SOLD", "CANCELLED"];
const STATUS_BADGE: Record<TradeInStatus, string> = {
  OFFERED: "bg-tertiary-container text-on-tertiary-container",
  PURCHASED: "bg-primary-container text-on-primary-container",
  SOLD: "bg-secondary-container text-on-secondary-container",
  CANCELLED: "bg-surface-container-high text-on-surface-variant",
};
const CONFIRM_DESC: Record<TradeInStatus, string> = {
  OFFERED: "",
  PURCHASED: "tradeins.confirm_purchase",
  SOLD: "tradeins.confirm_sell",
  CANCELLED: "tradeins.confirm_cancel",
};
const SKELETON_ROWS = ["r1", "r2", "r3", "r4"];
const SKELETON_COLS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];

export default function TradeInsPage() {
  const { t } = useTranslation();
  const canCreate = useCan({ tradeins: ["create"] });
  const canEdit = useCan({ tradeins: ["edit"] });
  const canCancel = useCan({ tradeins: ["cancel"] });
  const [status, setStatus] = useState<TradeInStatus | "">("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TradeInListResponse | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    item: TradeIn;
    target: TradeInStatus;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchTradeIns({ limit: PAGE_SIZE, page, status }));
      setError(null);
    } catch {
      setError(t("tradeins.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, status, t]);

  useEffect(() => {
    load();
  }, [load]);

  const doTransition = async () => {
    if (!pending) {
      return;
    }
    const { item, target } = pending;
    setPending(null);
    setBusyId(item.id);
    setError(null);
    try {
      await transitionTradeIn(item.id, target);
      await load();
    } catch {
      setError(t("tradeins.transition_failed"));
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const isEmpty = !isLoading && (!data || data.items.length === 0);

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("tradeins.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("tradeins.subtitle")}
          </p>
        </div>
        {canCreate && (
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold font-headline text-on-primary text-sm transition-colors hover:bg-primary-container hover:text-on-primary-container"
            onClick={() => setShowModal(true)}
            type="button"
          >
            <Icon name="add" size="sm" />
            {t("tradeins.new")}
          </button>
        )}
      </div>

      {!isEmpty && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            className={`rounded-full px-4 py-1.5 font-label text-sm transition-colors ${
              status === ""
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            }`}
            onClick={() => {
              setStatus("");
              setPage(1);
            }}
            type="button"
          >
            {t("tradeins.filter_all")}
          </button>
          {STATUSES.map((s) => (
            <button
              className={`rounded-full px-4 py-1.5 font-label text-sm transition-colors ${
                status === s
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
              }`}
              key={s}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
              type="button"
            >
              {t(`tradeins.status_${s.toLowerCase()}`)}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-xl bg-error-container px-4 py-3 text-on-error-container text-sm">
          {error}
        </p>
      )}

      {isEmpty && (
        <div
          className="flex flex-col items-center justify-center py-16"
          role="status"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-low">
            <Icon
              className="text-on-surface-variant"
              name="currency_exchange"
              size="xl"
            />
          </div>
          <p className="font-bold font-headline text-lg text-on-surface">
            {t("tradeins.empty_title")}
          </p>
          <p className="mt-1 text-on-surface-variant text-sm">
            {t("tradeins.empty_desc")}
          </p>
        </div>
      )}

      {!isEmpty && data && (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-outline-variant border-b font-label text-on-surface-variant text-xs uppercase tracking-wider">
                <th className="px-5 py-3">{t("tradeins.col_code")}</th>
                <th className="px-5 py-3">{t("tradeins.col_customer")}</th>
                <th className="px-5 py-3">{t("tradeins.col_device")}</th>
                <th className="px-5 py-3">{t("tradeins.col_condition")}</th>
                <th className="px-5 py-3 text-right">
                  {t("tradeins.col_price")}
                </th>
                <th className="px-5 py-3">{t("tradeins.col_status")}</th>
                <th className="px-5 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                SKELETON_ROWS.map((row) => (
                  <tr className="border-outline-variant/40 border-b" key={row}>
                    {SKELETON_COLS.map((col) => (
                      <td className="px-5 py-4" key={col}>
                        <div className="h-3 w-20 animate-pulse rounded bg-surface-container-high" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!isLoading &&
                data.items.map((item) => (
                  <tr
                    className="border-outline-variant/40 border-b last:border-0"
                    key={item.id}
                  >
                    <td className="px-5 py-4 font-bold font-headline text-on-surface">
                      {item.code}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-on-surface">
                        {item.customer.name}
                      </p>
                      <p className="text-on-surface-variant text-xs">
                        {item.customer.phone}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-on-surface">
                        {item.deviceBrand} {item.deviceModel}
                      </p>
                      {item.imei && (
                        <p className="text-on-surface-variant text-xs">
                          IMEI {item.imei}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4 text-on-surface-variant">
                      {t(`tradeins.condition_${item.condition.toLowerCase()}`)}
                    </td>
                    <td className="px-5 py-4 text-right font-bold text-on-surface">
                      {formatCurrency(Number(item.purchasePrice))}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-extrabold text-xs uppercase tracking-wider ${STATUS_BADGE[item.status]}`}
                      >
                        {t(`tradeins.status_${item.status.toLowerCase()}`)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1">
                        {item.status === "OFFERED" && canEdit && (
                          <button
                            className="rounded-lg p-2 text-primary transition-colors hover:bg-surface-container disabled:opacity-50"
                            disabled={busyId === item.id}
                            onClick={() =>
                              setPending({ item, target: "PURCHASED" })
                            }
                            title={t("tradeins.action_purchase")}
                            type="button"
                          >
                            <Icon name="shopping_cart_checkout" size="sm" />
                          </button>
                        )}
                        {item.status === "PURCHASED" && canEdit && (
                          <button
                            className="rounded-lg p-2 text-primary transition-colors hover:bg-surface-container disabled:opacity-50"
                            disabled={busyId === item.id}
                            onClick={() => setPending({ item, target: "SOLD" })}
                            title={t("tradeins.action_sell")}
                            type="button"
                          >
                            <Icon name="sell" size="sm" />
                          </button>
                        )}
                        {(item.status === "OFFERED" ||
                          item.status === "PURCHASED") &&
                          canCancel && (
                            <button
                              className="rounded-lg p-2 text-error transition-colors hover:bg-surface-container disabled:opacity-50"
                              disabled={busyId === item.id}
                              onClick={() =>
                                setPending({ item, target: "CANCELLED" })
                              }
                              title={t("tradeins.action_cancel")}
                              type="button"
                            >
                              <Icon name="cancel" size="sm" />
                            </button>
                          )}
                        <button
                          className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container"
                          onClick={() =>
                            window.open(
                              `/api/trade-ins/${item.id}/receipt`,
                              "_blank"
                            )
                          }
                          title={t("tradeins.action_receipt")}
                          type="button"
                        >
                          <Icon name="receipt_long" size="sm" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {!isEmpty && data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-on-surface-variant text-sm">
            {t("tradeins.page_of", { page, pages: totalPages })}
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-xl bg-surface-container-high px-4 py-2 font-bold text-on-surface-variant text-sm disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              type="button"
            >
              {t("previous")}
            </button>
            <button
              className="rounded-xl bg-surface-container-high px-4 py-2 font-bold text-on-surface-variant text-sm disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              type="button"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button
            aria-label={t("cancel")}
            className="absolute inset-0 bg-overlay"
            onClick={() => setPending(null)}
            type="button"
          />
          <ConfirmDiscardDialog
            description={t(CONFIRM_DESC[pending.target])}
            discardLabel={t("tradeins.confirm_yes")}
            keepLabel={t("cancel")}
            onDiscard={doTransition}
            onKeepEditing={() => setPending(null)}
            open={true}
            title={t("tradeins.confirm_title")}
          />
        </div>
      )}

      {showModal && (
        <TradeInModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            load();
          }}
        />
      )}
    </>
  );
}
