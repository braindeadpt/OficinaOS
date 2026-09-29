import { PAYMENT_METHODS } from "@shared/constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Can } from "@/components/modules/can";
import RestockHint from "@/components/pos/restock-hint";
import type { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { usePartsCatalogStore } from "@/stores/parts-catalog";
import { useSalesStore } from "@/stores/sales";
import { useSettingsStore } from "@/stores/settings";

function fmt(n: number, currency: string): string {
  return formatCurrency(n, currency);
}

let payUid = 0;
function nextPayUid(): string {
  payUid += 1;
  return `pay-${payUid}`;
}

export default function PosPage() {
  const { t } = useTranslation();
  const currency = useSettingsStore((s) => s.shopSettings?.currency ?? "EUR");
  const {
    cart,
    cartTotal,
    addCatalogPart,
    addCustomItem,
    updateQuantity,
    removeLine,
    clearCart,
    checkout,
    isCheckingOut,
  } = useSalesStore();

  const { parts, isLoading, fetchParts } = usePartsCatalogStore();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [showCheckout, setShowCheckout] = useState(false);
  const [payMethod, setPayMethod] = useState<
    "CASH" | "CARD" | "TRANSFER" | "OTHER"
  >("CASH");
  const [payAmount, setPayAmount] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payments, setPayments] = useState<
    Array<{
      method: "CASH" | "CARD" | "TRANSFER" | "OTHER";
      amount: number;
      reference?: string;
      uid: string;
    }>
  >([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchParts({ isActive: true, search: debounced || undefined, limit: 20 });
  }, [debounced, fetchParts]);

  const paidSum = useMemo(
    () => payments.reduce((s, p) => s + p.amount, 0),
    [payments]
  );

  const inCartQty = useCallback(
    (partId: string) =>
      cart
        .filter((l) => l.partId === partId)
        .reduce((s, l) => s + l.quantity, 0),
    [cart]
  );
  const remaining = useMemo(
    () => Math.round((cartTotal - paidSum) * 100) / 100,
    [cartTotal, paidSum]
  );

  const handleAddPayment = useCallback(() => {
    const amount = Number.parseFloat(payAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      return;
    }
    setPayments((prev) => [
      ...prev,
      {
        amount,
        method: payMethod,
        uid: nextPayUid(),
        ...(payReference.trim() ? { reference: payReference.trim() } : {}),
      },
    ]);
    setPayAmount("");
    setPayReference("");
    setPayMethod("CASH");
  }, [payAmount, payMethod, payReference]);

  const handleCheckout = useCallback(async () => {
    try {
      const sale = await checkout(payments);
      toast.success(t("pos.sale_completed", { code: sale.saleCode }));
      setShowCheckout(false);
      setPayments([]);
      window.open(`/api/sales/${sale.id}/receipt`, "_blank");
    } catch (err: unknown) {
      const apiErr = err as ApiError & { message?: string };
      const code = (apiErr as { code?: string }).code;
      if (code === "INSUFFICIENT_STOCK") {
        toast.error(t("errors.insufficient_stock"));
      } else {
        toast.error(apiErr?.message ?? t("pos.checkout_failed"));
      }
    }
  }, [checkout, payments, t]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight">
        {t("pos.title")}
      </h1>
      <p className="mt-1 font-body text-on-surface-variant text-sm">
        {t("pos.subtitle")}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Catalog browser */}
        <div className="lg:col-span-2">
          <input
            className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("pos.search_placeholder")}
            type="text"
            value={search}
          />

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {parts.map((p) => {
              const inCart = inCartQty(p.id);
              const available = p.stockQuantity - inCart;
              const soldOut = p.stockQuantity <= 0;
              const unavailable = soldOut || available <= 0;
              return (
                <button
                  className={`flex flex-col rounded-xl p-3 text-start transition-colors ${
                    unavailable
                      ? "bg-surface-container-low opacity-50"
                      : "bg-surface-container hover:bg-surface-container-high"
                  }`}
                  disabled={unavailable}
                  key={p.id}
                  onClick={() =>
                    addCatalogPart({
                      category: p.category,
                      defaultPrice: Number(p.defaultPrice ?? 0),
                      id: p.id,
                      name: p.name,
                      stockQuantity: p.stockQuantity,
                    })
                  }
                  type="button"
                >
                  <span className="line-clamp-2 font-bold font-headline text-on-surface text-sm">
                    {p.name}
                  </span>
                  <span className="mt-auto pt-2 font-bold text-primary text-sm">
                    {fmt(Number(p.defaultPrice ?? 0), currency)}
                  </span>
                  <span className="font-label text-on-surface-variant text-xs">
                    {t("pos.stock_label")}: {soldOut ? 0 : available}
                    {inCart > 0 && !soldOut && (
                      <span className="text-primary">
                        {" "}
                        · {t("pos.in_cart_short")} {inCart}
                      </span>
                    )}
                  </span>
                  {soldOut && <RestockHint partId={p.id} />}
                </button>
              );
            })}
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <span className="material-symbols-outlined animate-spin text-on-surface-variant">
                progress_activity
              </span>
            </div>
          )}

          <button
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-surface-container-high px-4 font-bold font-headline text-on-surface text-sm hover:bg-surface-container-highest"
            onClick={() => setShowCustomForm(true)}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {t("pos.add_custom_item")}
          </button>
        </div>

        {/* Cart */}
        <div className="rounded-2xl bg-surface-container p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold font-headline text-base text-on-surface">
              {t("pos.cart")}
            </h2>
            {cart.length > 0 && (
              <button
                className="font-label text-on-surface-variant text-xs hover:text-error"
                onClick={clearCart}
                type="button"
              >
                {t("pos.clear_cart")}
              </button>
            )}
          </div>

          {cart.length === 0 && (
            <p className="mt-3 font-body text-on-surface-variant text-sm">
              {t("pos.cart_empty")}
            </p>
          )}

          <ul className="mt-3 space-y-2">
            {cart.map((line, idx) => (
              <li
                className="flex items-center gap-2 rounded-xl bg-surface-container-lowest p-2.5"
                key={line.uid}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-on-surface text-sm">
                    {line.name}
                  </p>
                  <p className="font-label text-on-surface-variant text-xs">
                    {fmt(line.unitPrice, currency)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    aria-label={t("pos.decrease")}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-container-highest text-on-surface"
                    onClick={() => updateQuantity(idx, line.quantity - 1)}
                    type="button"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-bold text-sm">
                    {line.quantity}
                  </span>
                  <button
                    aria-label={
                      line.stockQuantity !== null &&
                      line.quantity >= line.stockQuantity
                        ? t("pos.max_stock_reached")
                        : t("pos.increase")
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-container-highest text-on-surface disabled:cursor-not-allowed disabled:opacity-30"
                    disabled={
                      line.stockQuantity !== null &&
                      line.quantity >= line.stockQuantity
                    }
                    onClick={() => updateQuantity(idx, line.quantity + 1)}
                    type="button"
                  >
                    +
                  </button>
                </div>
                <button
                  aria-label={t("pos.remove_line")}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-outline hover:bg-error/10 hover:text-error"
                  onClick={() => removeLine(idx)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    close
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-baseline justify-between border-outline-variant border-t pt-3">
            <span className="font-bold font-label text-on-surface-variant text-xs uppercase">
              {t("pos.total")}
            </span>
            <span className="font-extrabold font-headline text-primary text-xl">
              {fmt(cartTotal, currency)}
            </span>
          </div>

          <Can perm={{ sales: ["create"] }}>
            <button
              className="mt-4 w-full rounded-xl bg-primary py-3 font-bold font-headline text-on-primary text-sm disabled:opacity-50"
              disabled={cart.length === 0}
              onClick={() => {
                setPayments([]);
                setPayAmount(cartTotal > 0 ? String(cartTotal) : "");
                setShowCheckout(true);
              }}
              type="button"
            >
              {t("pos.checkout")}
            </button>
          </Can>
        </div>
      </div>

      {/* Custom item dialog */}
      {showCustomForm && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
        >
          <button
            aria-label={t("close_modal")}
            className="absolute inset-0 bg-on-surface/40"
            onClick={() => setShowCustomForm(false)}
            type="button"
          />
          <div className="modal-surface relative z-10 w-full max-w-sm rounded-xl bg-surface-container-lowest p-6 shadow-2xl">
            <h2 className="font-bold font-headline text-lg text-on-surface">
              {t("pos.add_custom_item")}
            </h2>
            <div className="mt-4 space-y-3">
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={t("pos.custom_name")}
                type="text"
                value={customName}
              />
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                inputMode="decimal"
                min="0"
                onChange={(e) => setCustomPrice(e.target.value)}
                placeholder={t("pos.custom_price")}
                type="number"
                value={customPrice}
              />
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                inputMode="numeric"
                min="1"
                onChange={(e) => setCustomQty(e.target.value)}
                type="number"
                value={customQty}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm"
                onClick={() => setShowCustomForm(false)}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="rounded-xl bg-primary px-5 py-2 font-bold font-headline text-on-primary text-sm disabled:opacity-50"
                disabled={
                  !(customName.trim() && Number.parseFloat(customPrice) >= 0)
                }
                onClick={() => {
                  addCustomItem({
                    name: customName.trim(),
                    quantity: Number.parseInt(customQty, 10) || 1,
                    unitPrice: Number.parseFloat(customPrice),
                  });
                  setCustomName("");
                  setCustomPrice("");
                  setCustomQty("1");
                  setShowCustomForm(false);
                }}
                type="button"
              >
                {t("pos.add_to_cart")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout dialog */}
      {showCheckout && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
        >
          <button
            aria-label={t("close_modal")}
            className="absolute inset-0 bg-on-surface/40"
            onClick={() => setShowCheckout(false)}
            type="button"
          />
          <div className="modal-surface relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
            <div className="border-outline-variant border-b px-6 py-4">
              <h2 className="font-bold font-headline text-lg text-on-surface">
                {t("pos.checkout")}
              </h2>
              <p className="font-label text-on-surface-variant text-xs">
                {t("pos.total")}: {fmt(cartTotal, currency)}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex gap-2">
                <select
                  className="h-11 flex-1 rounded-xl bg-surface-container-highest px-3 text-on-surface"
                  onChange={(e) =>
                    setPayMethod(
                      e.target.value as "CASH" | "CARD" | "TRANSFER" | "OTHER"
                    )
                  }
                  value={payMethod}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`payment_method.${m}`)}
                    </option>
                  ))}
                </select>
                <input
                  className="h-11 w-28 rounded-xl bg-surface-container-highest px-3 text-on-surface"
                  inputMode="decimal"
                  min="0.01"
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder={t("pos.amount")}
                  step="0.01"
                  type="number"
                  value={payAmount}
                />
              </div>
              <input
                className="mt-2 h-11 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                onChange={(e) => setPayReference(e.target.value)}
                placeholder={t("payments.reference_placeholder")}
                type="text"
                value={payReference}
              />
              <button
                className="mt-2 w-full rounded-xl bg-surface-container-high py-2.5 font-bold font-headline text-on-surface text-sm disabled:opacity-50"
                disabled={!(Number.parseFloat(payAmount) > 0)}
                onClick={handleAddPayment}
                type="button"
              >
                {t("pos.add_payment_line")}
              </button>

              {payments.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {payments.map((p, idx) => (
                    <li
                      className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-2 text-sm"
                      key={p.uid}
                    >
                      <span>
                        {t(`payment_method.${p.method}`)} ·{" "}
                        {fmt(p.amount, currency)}
                      </span>
                      <button
                        className="text-on-surface-variant hover:text-error"
                        onClick={() =>
                          setPayments((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          close
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex items-baseline justify-between">
                <span className="font-bold font-label text-on-surface-variant text-xs uppercase">
                  {t("pos.remaining")}
                </span>
                <span
                  className={`font-extrabold font-headline ${remaining === 0 ? "text-primary" : "text-error"}`}
                >
                  {fmt(remaining, currency)}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-outline-variant border-t px-6 py-4">
              <button
                className="px-4 py-2 font-bold font-headline text-on-surface-variant text-sm"
                onClick={() => setShowCheckout(false)}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:opacity-50"
                disabled={isCheckingOut || remaining !== 0}
                onClick={handleCheckout}
                type="button"
              >
                {isCheckingOut ? "..." : t("pos.complete_sale")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
