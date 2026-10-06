import { PartCategory } from "@shared/constants";
import type { PartsCatalog } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import type { ApiError } from "@/lib/api";
import { useJobsStore } from "@/stores/jobs";
import { usePartsCatalogStore } from "@/stores/parts-catalog";

const PART_CATEGORIES = Object.values(PartCategory);

type Mode = "catalog" | "custom";

interface FormData {
  category: string;
  partId?: string;
  partName: string;
  quantity: string;
  supplier: string;
  unitPrice: string;
}

const INITIAL_FORM: FormData = {
  partName: "",
  category: "OTHER",
  unitPrice: "",
  quantity: "1",
  supplier: "",
};

interface AddPartDialogProps {
  jobId: string;
  onAdded: () => void;
  onClose: () => void;
  open: boolean;
}

export default function AddPartDialog({
  jobId,
  open,
  onClose,
  onAdded,
}: AddPartDialogProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const [mode, setMode] = useState<Mode>("catalog");
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fetchedRef = useRef(false);
  const dirtyRef = useRef(false);
  const {
    parts: catalogItems,
    isLoading: loading,
    fetchParts: fetchCatalogParts,
  } = usePartsCatalogStore();

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm(INITIAL_FORM);
    setCatalogSearch("");
    setDebouncedSearch("");
    setMode("catalog");
    setSubmitError(null);
    fetchedRef.current = false;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      // Match the backdrop rule: a dirty form must not be lost on Escape.
      if (e.key === "Escape" && !dirtyRef.current) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || mode !== "catalog") {
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(catalogSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [open, mode, catalogSearch]);

  useEffect(() => {
    if (!open || mode !== "catalog") {
      return;
    }
    if (!debouncedSearch && fetchedRef.current) {
      return;
    }
    fetchedRef.current = true;
    fetchCatalogParts({ isActive: true, search: debouncedSearch || undefined });
  }, [open, mode, debouncedSearch, fetchCatalogParts]);

  const pickCatalogItem = useCallback((item: PartsCatalog) => {
    setForm({
      partId: item.id,
      partName: item.name,
      category: item.category ?? "OTHER",
      unitPrice: String(item.defaultPrice ?? 0),
      quantity: "1",
      supplier: item.supplier ?? "",
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const unitPrice = Number.parseFloat(form.unitPrice.replace(",", "."));
    const quantity = Number.parseInt(form.quantity, 10) || 1;
    if (!form.partName.trim() || Number.isNaN(unitPrice) || unitPrice < 0) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await useJobsStore.getState().addPart(jobId, {
        ...(form.partId ? { partId: form.partId } : {}),
        partName: form.partName.trim(),
        category: form.category,
        unitPrice,
        quantity,
        ...(form.supplier.trim() ? { supplier: form.supplier.trim() } : {}),
      });
      toast.success(t("job_part_success"));
      onAdded();
      onClose();
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      toast.error(t("job_part_failed"));
      if (apiErr.code === "JOB_IN_TERMINAL_STATUS") {
        setSubmitError(t("jobs_parts_terminal_status_error"));
      } else {
        setSubmitError(t("jobs_status_change_error_unknown"));
      }
    } finally {
      setSubmitting(false);
    }
  }, [form, jobId, onAdded, onClose, t]);

  if (!open) {
    return null;
  }

  const unitPrice = Number.parseFloat(form.unitPrice.replace(",", ".")) || 0;
  const quantity = Number.parseInt(form.quantity, 10) || 1;
  const canSubmit =
    form.partName.trim().length > 0 &&
    form.unitPrice.trim() !== "" &&
    !Number.isNaN(Number.parseFloat(form.unitPrice.replace(",", "."))) &&
    unitPrice >= 0;
  const isFormDirty =
    form.partName !== "" ||
    form.unitPrice !== "" ||
    form.quantity !== "1" ||
    form.supplier !== "" ||
    form.category !== "OTHER" ||
    form.partId !== undefined;
  dirtyRef.current = isFormDirty;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={isFormDirty ? undefined : onClose}
        type="button"
      />
      <div className="modal-surface relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-outline-variant border-b px-6 py-4">
          <h2 className="font-bold font-headline text-lg text-on-surface">
            {t("jobs_parts_add")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex border-outline-variant border-b">
          {(["catalog", "custom"] as Mode[]).map((m) => (
            <button
              className={`flex-1 py-3 text-center font-bold font-label text-xs uppercase tracking-wide transition-colors ${
                mode === m
                  ? "border-primary border-b-2 text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              key={m}
              onClick={() => {
                setMode(m);
                setForm(INITIAL_FORM);
              }}
              type="button"
            >
              {t(
                m === "catalog"
                  ? "jobs_parts_catalog_tab"
                  : "jobs_parts_custom_tab"
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {mode === "catalog" && !form.partId && (
            <div className="mb-4">
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface placeholder:text-outline"
                onChange={(e) => setCatalogSearch(e.target.value)}
                placeholder={t("jobs_parts_search_placeholder")}
                type="text"
                value={catalogSearch}
              />
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-surface-container-low">
                {loading && (
                  <div className="flex items-center justify-center py-4">
                    <span className="material-symbols-outlined animate-spin text-on-surface-variant text-sm">
                      progress_activity
                    </span>
                  </div>
                )}
                {!loading &&
                  catalogItems.map((item) => (
                    <button
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-container-high"
                      key={item.id}
                      onClick={() => pickCatalogItem(item)}
                      type="button"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold font-headline text-on-surface text-sm">
                          {item.name}
                        </p>
                        <p className="font-label text-on-surface-variant text-xs">
                          {item.defaultPrice == null
                            ? "--"
                            : fmt(Number(item.defaultPrice))}
                        </p>
                      </div>
                    </button>
                  ))}
                {!loading && catalogItems.length === 0 && (
                  <p className="px-4 py-3 font-body text-on-surface-variant text-sm">
                    {t("jobs_parts_catalog_empty")}
                  </p>
                )}
              </div>
            </div>
          )}

          {mode === "catalog" && form.partId && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2">
              <span className="material-symbols-outlined text-primary text-sm">
                check_circle
              </span>
              <span className="font-bold font-label text-primary text-xs">
                {form.partName}
              </span>
              <button
                className="ms-auto text-on-surface-variant hover:text-on-surface"
                onClick={() => setForm(INITIAL_FORM)}
                type="button"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="add-part-name"
              >
                {t("jobs_parts_part_name")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface disabled:opacity-50"
                disabled={!!form.partId}
                id="add-part-name"
                onChange={(e) =>
                  setForm((p) => ({ ...p, partName: e.target.value }))
                }
                type="text"
                value={form.partName}
              />
            </div>

            {!form.partId && (
              <div>
                <label
                  className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                  htmlFor="add-part-category"
                >
                  {t("jobs_parts_category")}
                </label>
                <select
                  className="h-12 w-full appearance-none rounded-xl bg-surface-container-highest px-4 text-on-surface"
                  id="add-part-category"
                  onChange={(e) =>
                    setForm((p) => ({ ...p, category: e.target.value }))
                  }
                  value={form.category}
                >
                  {PART_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`part_category.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                  htmlFor="add-part-price"
                >
                  {t("jobs_parts_unit_price")}
                </label>
                <input
                  className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                  id="add-part-price"
                  inputMode="decimal"
                  min="0"
                  onChange={(e) =>
                    setForm((p) => ({ ...p, unitPrice: e.target.value }))
                  }
                  type="number"
                  value={form.unitPrice}
                />
              </div>
              <div>
                <label
                  className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                  htmlFor="add-part-qty"
                >
                  {t("jobs_parts_quantity")}
                </label>
                <input
                  className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface"
                  id="add-part-qty"
                  inputMode="numeric"
                  min="1"
                  onChange={(e) =>
                    setForm((p) => ({ ...p, quantity: e.target.value }))
                  }
                  type="number"
                  value={form.quantity}
                />
              </div>
            </div>

            <div>
              <label
                className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
                htmlFor="add-part-supplier"
              >
                {t("jobs_parts_supplier")}
              </label>
              <input
                className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface placeholder:text-outline"
                id="add-part-supplier"
                onChange={(e) =>
                  setForm((p) => ({ ...p, supplier: e.target.value }))
                }
                placeholder={t("add_part_modal.supplier_placeholder")}
                type="text"
                value={form.supplier}
              />
            </div>

            <div className="rounded-xl bg-surface-container-low p-4">
              <div className="flex items-center justify-between">
                <span className="font-bold font-label text-on-surface-variant text-xs uppercase">
                  {t("jobs_parts_line_total")}
                </span>
                <span className="font-extrabold font-headline text-lg text-primary">
                  {fmt(unitPrice * quantity)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {submitError && (
          <div
            className="border-outline-variant border-t px-6 py-2"
            role="alert"
          >
            <p className="font-body text-error text-xs">{submitError}</p>
          </div>
        )}

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
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            type="button"
          >
            {submitting ? "..." : t("jobs_parts_add")}
          </button>
        </div>
      </div>
    </div>
  );
}
