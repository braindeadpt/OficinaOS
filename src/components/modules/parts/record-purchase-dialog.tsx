import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api, { type ApiError } from "@/lib/api";
import { usePartsCatalogStore } from "@/stores/parts-catalog";

export default function RecordPurchaseDialog({
  onClose,
  part,
}: {
  onClose: () => void;
  part: { id: string; name: string; stockQuantity: number };
}) {
  const { t } = useTranslation();
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleSubmit = async () => {
    const qty = Number.parseInt(quantity, 10);
    if (Number.isNaN(qty) || qty <= 0) {
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/parts/${part.id}/stock-movements`, {
        quantity: qty,
        ...(unitCost ? { unitCost: Number.parseFloat(unitCost) } : {}),
        ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t("parts_purchase_recorded"));
      usePartsCatalogStore.getState().fetchParts();
      onClose();
    } catch (err: unknown) {
      const apiErr = err as ApiError & { message?: string };
      toast.error(apiErr?.message ?? t("parts_purchase_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const parsedQty = Number.parseInt(quantity, 10);

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
      <div className="modal-surface relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
        <div className="border-outline-variant border-b px-6 py-4">
          <h2 className="font-bold font-headline text-lg text-on-surface">
            {t("parts_record_purchase")}
          </h2>
          <p className="font-label text-on-surface-variant text-xs">
            {part.name} · {t("pos.stock_label")}: {part.stockQuantity}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="purchase-qty"
              >
                {t("parts_purchase_quantity")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
                id="purchase-qty"
                inputMode="numeric"
                min="1"
                onChange={(e) => setQuantity(e.target.value)}
                type="number"
                value={quantity}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                  htmlFor="purchase-cost"
                >
                  {t("parts_purchase_unit_cost")}
                </label>
                <input
                  className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
                  id="purchase-cost"
                  inputMode="decimal"
                  min="0"
                  onChange={(e) => setUnitCost(e.target.value)}
                  step="0.01"
                  type="number"
                  value={unitCost}
                />
              </div>
              <div>
                <label
                  className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                  htmlFor="purchase-supplier"
                >
                  {t("parts_purchase_supplier")}
                </label>
                <input
                  className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
                  id="purchase-supplier"
                  onChange={(e) => setSupplier(e.target.value)}
                  type="text"
                  value={supplier}
                />
              </div>
            </div>
            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="purchase-reference"
              >
                {t("payments.reference")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
                id="purchase-reference"
                onChange={(e) => setReference(e.target.value)}
                placeholder={t("payments.reference_placeholder")}
                type="text"
                value={reference}
              />
            </div>
            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="purchase-note"
              >
                {t("payments.note")}
              </label>
              <textarea
                className="w-full rounded-xl bg-surface-container-highest px-4 py-3 text-on-surface focus:ring-2 focus:ring-primary"
                id="purchase-note"
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                value={note}
              />
            </div>
            {parsedQty > 0 && (
              <div className="rounded-xl bg-primary/10 px-4 py-3">
                <p className="font-bold font-label text-primary text-xs uppercase">
                  {t("parts_purchase_new_stock")}:{" "}
                  {part.stockQuantity + parsedQty}
                </p>
              </div>
            )}
          </div>
        </div>

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
            disabled={!(parsedQty > 0) || submitting}
            onClick={handleSubmit}
            type="button"
          >
            {submitting ? "..." : t("parts_record_purchase")}
          </button>
        </div>
      </div>
    </div>
  );
}
