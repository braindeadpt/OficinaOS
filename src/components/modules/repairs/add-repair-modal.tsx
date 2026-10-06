import type { RepairCategoryType } from "@shared/constants";
import type { RepairCatalog } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { REPAIR_CATEGORY_ICONS } from "@/lib/category-display";

export interface RepairFormData {
  basePrice: string;
  category: RepairCategoryType;
  name: string;
}

const PRICE_REGEX = /^\d*\.?\d{0,2}$/;

const INITIAL_FORM: RepairFormData = {
  basePrice: "",
  category: "HARDWARE",
  name: "",
};

interface AddRepairModalProps {
  editingRepair?: RepairCatalog | null;
  onClose: () => void;
  onSubmit: (data: RepairFormData) => Promise<void>;
  open: boolean;
}

const REPAIR_CATEGORIES: {
  key: RepairCategoryType;
  labelKey: string;
}[] = [
  { key: "HARDWARE", labelKey: "repair_category.HARDWARE" },
  { key: "SOFTWARE", labelKey: "repair_category.SOFTWARE" },
  { key: "DIAGNOSTIC", labelKey: "repair_category.DIAGNOSTIC" },
  { key: "OTHER", labelKey: "repair_category.OTHER" },
];

function isDirty(
  form: RepairFormData,
  editingRepair: RepairCatalog | null | undefined
): boolean {
  if (editingRepair) {
    return (
      form.name !== editingRepair.name ||
      form.category !== (editingRepair.category as RepairCategoryType) ||
      Number.parseFloat(form.basePrice) !==
        Number.parseFloat(String(editingRepair.defaultPrice))
    );
  }
  return (
    form.name !== INITIAL_FORM.name ||
    form.category !== INITIAL_FORM.category ||
    form.basePrice !== INITIAL_FORM.basePrice
  );
}

export default function AddRepairModal({
  editingRepair,
  onClose,
  onSubmit,
  open,
}: AddRepairModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  const isEditing = !!editingRepair;
  const [form, setForm] = useState<RepairFormData>(() => {
    if (editingRepair) {
      return {
        name: editingRepair.name,
        category: editingRepair.category as RepairCategoryType,
        basePrice: String(editingRepair.defaultPrice),
      };
    }
    return { ...INITIAL_FORM };
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<"name" | "basePrice", string>>
  >({});
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  useEffect(() => {
    if (editingRepair) {
      setForm({
        name: editingRepair.name,
        category: editingRepair.category as RepairCategoryType,
        basePrice: String(editingRepair.defaultPrice),
      });
    } else {
      setForm({ ...INITIAL_FORM });
    }
    setErrors({});
  }, [editingRepair]);

  const update = useCallback(
    <K extends keyof RepairFormData>(key: K, value: RepairFormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      if (key === "name" && value.toString().trim()) {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
      if (
        key === "basePrice" &&
        value &&
        Number.parseFloat(String(value)) > 0
      ) {
        setErrors((prev) => ({ ...prev, basePrice: undefined }));
      }
    },
    []
  );

  const handleRequestClose = useCallback(() => {
    setForm((currentForm) => {
      if (isDirty(currentForm, editingRepair)) {
        setShowConfirmClose(true);
      } else {
        onClose();
      }
      return currentForm;
    });
  }, [editingRepair, onClose]);

  useModalEffects(open, handleRequestClose, dialogRef);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Partial<Record<"name" | "basePrice", string>> = {};
    if (!form.name.trim()) {
      newErrors.name = t("repair_modal.error_name_required");
    }
    const priceVal = Number.parseFloat(form.basePrice);
    if (!form.basePrice || Number.isNaN(priceVal) || priceVal <= 0) {
      newErrors.basePrice = t("repair_modal.error_price_invalid");
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(form);
    } catch {
      setIsSubmitting(false);
      return;
    }
    setForm({ ...INITIAL_FORM });
    setErrors({});
    setIsSubmitting(false);
    onClose();
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        aria-hidden="true"
        className="absolute inset-0 bg-overlay backdrop-blur-[20px]"
        onClick={handleRequestClose}
        tabIndex={-1}
        type="button"
      />
      <ConfirmDiscardDialog
        onDiscard={onClose}
        onKeepEditing={() => setShowConfirmClose(false)}
        open={showConfirmClose}
      />
      <div
        aria-labelledby="add-repair-modal-title"
        aria-modal="true"
        className="relative z-10 mx-4 max-h-[90dvh] w-full max-w-[520px] overflow-y-auto rounded-2xl bg-surface-container-lowest shadow-2xl"
        id="add-repair-modal"
        ref={dialogRef}
        role="dialog"
      >
        <form onSubmit={handleSubmit}>
          <div className="bg-surface-container-low px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h2
                  className="font-bold font-headline text-on-surface text-xl tracking-tight"
                  id="add-repair-modal-title"
                >
                  {isEditing ? t("edit") : t("repair_modal.title")}
                </h2>
                <p className="mt-0.5 text-on-surface-variant text-sm">
                  {isEditing
                    ? t("repair_modal.subtitle_edit")
                    : t("repair_modal.subtitle")}
                </p>
              </div>
              <button
                aria-label={t("close")}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                onClick={handleRequestClose}
                type="button"
              >
                <Icon name="close" size="sm" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-6">
            <div>
              <Label className="mb-2 block" htmlFor="repair-category">
                {t("repair_modal.category_section")}
              </Label>
              <div className="flex flex-wrap gap-2">
                {REPAIR_CATEGORIES.map((cat) => (
                  <button
                    className={`min-h-[44px] rounded-xl px-4 py-2.5 font-bold font-label text-xs transition-all ${
                      form.category === cat.key
                        ? "bg-primary text-on-primary shadow-sm"
                        : "bg-surface-container-highest text-on-surface-variant hover:bg-surface-variant"
                    }`}
                    key={cat.key}
                    onClick={() => update("category", cat.key)}
                    type="button"
                  >
                    <Icon
                      className="me-1 -mt-0.5 inline align-middle"
                      name={REPAIR_CATEGORY_ICONS[cat.key].icon}
                      size="sm"
                    />
                    {t(cat.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="mb-2 block" htmlFor="repair-name">
                {t("repair_modal.service_name")}
              </Label>
              <Input
                aria-describedby={errors.name ? "error-repair-name" : undefined}
                aria-invalid={!!errors.name || undefined}
                autoComplete="off"
                iconStart="build_circle"
                id="repair-name"
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("repair_modal.service_name_placeholder")}
                value={form.name}
              />
              {errors.name && (
                <p
                  className="mt-1.5 rounded-lg bg-error-container px-3 py-1.5 font-bold text-on-error-container text-xs"
                  id="error-repair-name"
                  role="alert"
                >
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor="repair-price">
                {t("repair_modal.base_price")}
              </Label>
              <div className="relative">
                <span className="absolute start-4 top-1/2 -translate-y-1/2 font-mono text-on-surface-variant text-sm">
                  {t("currency_eur")}
                </span>
                <Input
                  aria-describedby={
                    errors.basePrice ? "error-repair-price" : undefined
                  }
                  aria-invalid={!!errors.basePrice || undefined}
                  autoComplete="off"
                  className="ps-10 font-mono"
                  id="repair-price"
                  min="0"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || PRICE_REGEX.test(val)) {
                      update("basePrice", val);
                    }
                  }}
                  placeholder="0"
                  step="0.01"
                  type="number"
                  value={form.basePrice}
                />
                {errors.basePrice && (
                  <p
                    className="mt-1.5 rounded-lg bg-error-container px-3 py-1.5 font-bold text-on-error-container text-xs"
                    id="error-repair-price"
                    role="alert"
                  >
                    {errors.basePrice}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-surface-container-low px-4 py-3 text-on-surface-variant text-xs leading-relaxed">
              <span className="font-bold text-primary italic">
                {t("note")}:
              </span>{" "}
              {t("repair_modal.pricing_note")}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <Button
              onClick={handleRequestClose}
              type="button"
              variant="secondary"
            >
              {t("repair_modal.cancel")}
            </Button>
            <Button
              icon={isEditing ? "check" : "add"}
              loading={isSubmitting}
              type="submit"
            >
              {isEditing ? t("save") : t("repair_modal.create_service")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
