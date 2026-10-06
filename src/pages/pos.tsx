import { PAYMENT_METHODS } from "@shared/constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Can } from "@/components/modules/can";
import RestockHint from "@/components/pos/restock-hint";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { useModalEffects } from "@/hooks/use-modal-effects";
import type { ApiError } from "@/lib/api";
import { fetchInvoicingStatus, issueSaleInvoice } from "@/lib/api-invoicing";
import { printSaleReceipt, usesThermalPrinter } from "@/lib/print";
import { usePartsCatalogStore } from "@/stores/parts-catalog";
import { useSalesStore } from "@/stores/sales";

let payUid = 0;
function nextPayUid(): string {
  payUid += 1;
  return `pay-${payUid}`;
}

// When a cash customer overpays, the recorded payment is what was applied
// to the sale — the rest leaves the till as change.
function applyCashChange<T extends { amount: number; method: string }>(
  payments: T[],
  changeDue: number
): T[] {
  const paymentsToSend = payments.map((p) => ({ ...p }));
  let excess = changeDue;
  for (let i = paymentsToSend.length - 1; i >= 0 && excess > 0; i--) {
    const p = paymentsToSend[i];
    if (p.method !== "CASH") {
      continue;
    }
    const applied = Math.max(0, p.amount - excess);
    excess = Math.max(0, excess - (p.amount - applied));
    p.amount = Math.round(applied * 100) / 100;
  }
  return paymentsToSend;
}

function issueInvoiceToast(
  saleId: string,
  t: (key: string, opts?: Record<string, unknown>) => string
) {
  issueSaleInvoice(saleId)
    .then((inv) => {
      toast.success(
        t("pos.invoice_issued", { number: inv.number ?? "—" }),
        inv.permalink
          ? {
              action: {
                label: t("pos.invoice_open"),
                onClick: () => window.open(inv.permalink ?? "", "_blank"),
              },
            }
          : undefined
      );
    })
    .catch((e: unknown) => {
      const code = (e as ApiError & { code?: string }).code;
      toast.error(
        code === "ALREADY_INVOICED"
          ? t("pos.invoice_already")
          : t("pos.invoice_failed")
      );
    });
}

export default function PosPage() {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
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
  const debounced = useDebounce(search, 300);
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
  const [invoicingReady, setInvoicingReady] = useState(false);
  const customFormRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  useModalEffects(
    showCustomForm,
    () => setShowCustomForm(false),
    customFormRef
  );
  useModalEffects(showCheckout, () => setShowCheckout(false), checkoutRef);

  useEffect(() => {
    fetchInvoicingStatus()
      .then((s) => setInvoicingReady(s.enabled && s.module))
      .catch(() => setInvoicingReady(false));
  }, []);

  useEffect(() => {
    fetchParts({ isActive: true, search: debounced || undefined, limit: 20 });
  }, [debounced, fetchParts]);

  const paidSum = useMemo(
    () => payments.reduce((s, p) => s + p.amount, 0),
    [payments]
  );
  const cashPaid = useMemo(
    () =>
      payments
        .filter((p) => p.method === "CASH")
        .reduce((s, p) => s + p.amount, 0),
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
  // Overpayment is only valid when the excess can leave the till as change —
  // i.e. it was tendered in cash. Card/transfer overpay stays blocked.
  const changeDue = Math.max(0, Math.round((paidSum - cartTotal) * 100) / 100);
  const canComplete =
    cart.length > 0 &&
    (remaining === 0 || (changeDue > 0 && changeDue <= cashPaid + 0.001));

  const handleAddPayment = useCallback(() => {
    const amount = Number.parseFloat(payAmount.replace(",", "."));
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
    // window.open after `await` is popup-blocked — reserve the tab now.
    // With a configured ESC/POS printer the server prints directly, no tab.
    const thermal = usesThermalPrinter();
    const receiptTab = thermal ? null : window.open("", "_blank");
    try {
      const paymentsToSend = applyCashChange(payments, changeDue);
      const sale = await checkout(paymentsToSend.filter((p) => p.amount > 0));
      toast.success(t("pos.sale_completed", { code: sale.saleCode }), {
        action: invoicingReady
          ? {
              label: t("pos.issue_invoice"),
              onClick: () => issueInvoiceToast(sale.id, t),
            }
          : undefined,
      });
      setShowCheckout(false);
      setPayments([]);
      if (thermal) {
        printSaleReceipt(sale.id);
      } else if (receiptTab) {
        receiptTab.location.href = `/api/sales/${sale.id}/receipt`;
      }
    } catch (err: unknown) {
      receiptTab?.close();
      const apiErr = err as ApiError & { message?: string };
      const code = (apiErr as { code?: string }).code;
      if (code === "INSUFFICIENT_STOCK") {
        toast.error(t("errors.insufficient_stock"));
      } else {
        toast.error(apiErr?.message ?? t("pos.checkout_failed"));
      }
    }
  }, [checkout, payments, changeDue, invoicingReady, t]);

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
            className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface placeholder:text-outline"
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
                    {fmt(Number(p.defaultPrice ?? 0))}
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
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {["a", "b", "c", "d", "e", "f"].map((k) => (
                <CardSkeleton key={k} />
              ))}
            </div>
          )}

          {!isLoading && parts.length === 0 && (
            <div className="mt-4 rounded-2xl bg-surface-container-low px-6 py-10 text-center">
              <p className="font-body text-on-surface-variant text-sm">
                {t("pos.no_parts_found")}
              </p>
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
                    {fmt(line.unitPrice)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    aria-label={t("pos.decrease")}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-surface-container-highest text-on-surface"
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
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-surface-container-highest text-on-surface disabled:cursor-not-allowed disabled:opacity-30"
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
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-outline hover:bg-error/10 hover:text-error"
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
              {fmt(cartTotal)}
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
          <div
            className="modal-surface relative z-10 w-full max-w-sm rounded-xl bg-surface-container-lowest p-6 shadow-2xl"
            ref={customFormRef}
          >
            <h2 className="font-bold font-headline text-lg text-on-surface">
              {t("pos.add_custom_item")}
            </h2>
            <div className="mt-4 space-y-3">
              <input
                aria-label={t("pos.custom_name")}
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                onChange={(e) => setCustomName(e.target.value)}
                placeholder={t("pos.custom_name")}
                type="text"
                value={customName}
              />
              <input
                aria-label={t("pos.custom_price")}
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                inputMode="decimal"
                min="0"
                onChange={(e) => setCustomPrice(e.target.value)}
                placeholder={t("pos.custom_price")}
                type="number"
                value={customPrice}
              />
              <input
                aria-label={t("pos.custom_qty")}
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                inputMode="numeric"
                min="1"
                onChange={(e) => setCustomQty(e.target.value)}
                placeholder={t("pos.custom_qty")}
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
                  !(
                    customName.trim() &&
                    Number.parseFloat(customPrice.replace(",", ".")) >= 0
                  )
                }
                onClick={() => {
                  addCustomItem({
                    name: customName.trim(),
                    quantity: Number.parseInt(customQty, 10) || 1,
                    unitPrice: Number.parseFloat(customPrice.replace(",", ".")),
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
          <div
            className="modal-surface relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl"
            ref={checkoutRef}
          >
            <div className="border-outline-variant border-b px-6 py-4">
              <h2 className="font-bold font-headline text-lg text-on-surface">
                {t("pos.checkout")}
              </h2>
              <p className="font-label text-on-surface-variant text-xs">
                {t("pos.total")}: {fmt(cartTotal)}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex gap-2">
                <select
                  aria-label={t("payments.method")}
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
                  aria-label={t("pos.amount")}
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
                aria-label={t("payments.reference_placeholder")}
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
                        {t(`payment_method.${p.method}`)} · {fmt(p.amount)}
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
                  className={`font-extrabold font-headline ${remaining <= 0 ? "text-primary" : "text-error"}`}
                >
                  {fmt(Math.max(0, remaining))}
                </span>
              </div>
              {changeDue > 0 && (
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="font-bold font-label text-on-surface-variant text-xs uppercase">
                    {t("pos.change_due")}
                  </span>
                  <span className="font-extrabold font-headline text-on-surface">
                    {fmt(changeDue)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-outline-variant border-t px-6 py-4">
              <Button
                onClick={() => setShowCheckout(false)}
                type="button"
                variant="secondary"
              >
                {t("cancel")}
              </Button>
              <Button
                disabled={!canComplete}
                loading={isCheckingOut}
                onClick={handleCheckout}
                type="button"
              >
                {t("pos.complete_sale")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
