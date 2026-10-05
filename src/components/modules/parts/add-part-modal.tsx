import type { PartCategoryType } from "@shared/constants";
import { PartCategory } from "@shared/constants";
import type { PartsCatalog } from "@shared/types";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useModalEffects } from "@/hooks/use-modal-effects";

interface AddPartFormData {
  category: PartCategoryType | "";
  defaultPrice: string;
  isActive: boolean;
  listedOnline: boolean;
  name: string;
  supplier: string;
}

interface AddPartModalProps {
  editingPart?: PartsCatalog | null;
  onClose: () => void;
  onSubmit: (
    data: Omit<AddPartFormData, "defaultPrice"> & { defaultPrice: number }
  ) => void;
}

const CATEGORIES: PartCategoryType[] = Object.values(PartCategory);
const PRICE_REGEX = /^\d*\.?\d{0,2}$/;

const INITIAL_FORM: AddPartFormData = {
  name: "",
  category: "",
  defaultPrice: "",
  supplier: "",
  isActive: true,
  listedOnline: false,
};

function isDirty(
  form: AddPartFormData,
  editingPart: PartsCatalog | null | undefined
): boolean {
  if (editingPart) {
    return (
      form.name !== editingPart.name ||
      form.category !== editingPart.category ||
      Number.parseFloat(form.defaultPrice) !==
        Number(editingPart.defaultPrice) ||
      form.supplier !== (editingPart.supplier ?? "") ||
      form.isActive !== editingPart.isActive ||
      form.listedOnline !== editingPart.listedOnline
    );
  }
  return (
    form.name !== INITIAL_FORM.name ||
    form.category !== INITIAL_FORM.category ||
    form.defaultPrice !== INITIAL_FORM.defaultPrice ||
    form.supplier !== INITIAL_FORM.supplier ||
    form.isActive !== INITIAL_FORM.isActive ||
    form.listedOnline !== INITIAL_FORM.listedOnline
  );
}

export default function AddPartModal({
  editingPart,
  onClose,
  onSubmit,
}: AddPartModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(true, onClose, dialogRef);

  const isEditing = !!editingPart;

  const [form, setForm] = useState<AddPartFormData>(() => {
    if (editingPart) {
      return {
        name: editingPart.name,
        category: editingPart.category as PartCategoryType,
        defaultPrice: String(editingPart.defaultPrice),
        supplier: editingPart.supplier ?? "",
        isActive: editingPart.isActive,
        listedOnline: editingPart.listedOnline,
      };
    }
    return { ...INITIAL_FORM };
  });
  const [errors, setErrors] = useState<
    Partial<Record<"name" | "category" | "defaultPrice", string>>
  >({});
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const update = useCallback(
    <K extends keyof AddPartFormData>(key: K, value: AddPartFormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      if (key === "name" && value.toString().trim()) {
        setErrors((prev) => ({ ...prev, name: undefined }));
      }
      if (key === "category" && value) {
        setErrors((prev) => ({ ...prev, category: undefined }));
      }
      if (
        key === "defaultPrice" &&
        value &&
        Number.parseFloat(String(value)) > 0
      ) {
        setErrors((prev) => ({ ...prev, defaultPrice: undefined }));
      }
    },
    []
  );

  const handleRequestClose = useCallback(() => {
    if (isDirty(form, editingPart ?? null)) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  }, [form, editingPart, onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newErrors: Partial<
      Record<"name" | "category" | "defaultPrice", string>
    > = {};
    if (!form.name.trim()) {
      newErrors.name = t("add_part_modal.error_name_required");
    }
    if (!form.category) {
      newErrors.category = t("add_part_modal.error_category_required");
    }
    const priceVal = Number.parseFloat(form.defaultPrice);
    if (!form.defaultPrice || Number.isNaN(priceVal) || priceVal <= 0) {
      newErrors.defaultPrice = t("add_part_modal.error_price_invalid");
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    onSubmit({
      name: form.name,
      category: form.category as PartCategoryType,
      defaultPrice: priceVal,
      supplier: form.supplier,
      isActive: form.isActive,
      listedOnline: form.listedOnline,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        aria-hidden="true"
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-[20px]"
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
        aria-labelledby="add-part-modal-title"
        aria-modal="true"
        className="relative z-10 mx-4 max-h-[90dvh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-surface-container-lowest shadow-2xl"
        id="add-part-modal"
        ref={dialogRef}
        role="dialog"
      >
        <form onSubmit={handleSubmit}>
          <div className="bg-surface-container-low px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h2
                  className="font-bold font-headline text-on-surface text-xl tracking-tight"
                  id="add-part-modal-title"
                >
                  {isEditing ? t("edit_part") : t("add_part_modal.title")}
                </h2>
                <p className="mt-0.5 text-on-surface-variant text-sm">
                  {t("add_part_modal.subtitle")}
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
              <Label className="mb-2 block" htmlFor="part-name">
                {t("add_part_modal.part_name")}
              </Label>
              <Input
                aria-describedby={errors.name ? "error-part-name" : undefined}
                aria-invalid={!!errors.name || undefined}
                autoComplete="off"
                id="part-name"
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("add_part_modal.part_name_placeholder")}
                required
                value={form.name}
              />
              {errors.name && (
                <p
                  className="mt-1.5 rounded-lg bg-error-container px-3 py-1.5 font-bold text-on-error-container text-xs"
                  id="error-part-name"
                  role="alert"
                >
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor="part-category">
                {t("add_part_modal.category")}
              </Label>
              <div className="relative">
                <Select
                  aria-describedby={
                    errors.category ? "error-part-category" : undefined
                  }
                  aria-invalid={!!errors.category || undefined}
                  id="part-category"
                  onChange={(e) =>
                    update("category", e.target.value as PartCategoryType)
                  }
                  required
                  value={form.category}
                >
                  <option disabled value="">
                    {t("add_part_modal.category_placeholder")}
                  </option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {t(`part_category.${cat}`)}
                    </option>
                  ))}
                </Select>
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2">
                  <Icon name="expand_more" size="sm" />
                </span>
              </div>
              {errors.category && (
                <p
                  className="mt-1.5 rounded-lg bg-error-container px-3 py-1.5 font-bold text-on-error-container text-xs"
                  id="error-part-category"
                  role="alert"
                >
                  {errors.category}
                </p>
              )}
            </div>

            <div>
              <Label className="mb-2 block" htmlFor="part-price">
                {t("add_part_modal.default_price")}
              </Label>
              <div className="relative">
                <span className="absolute start-4 top-1/2 -translate-y-1/2 font-mono text-on-surface-variant text-sm">
                  {t("currency_eur")}
                </span>
                <Input
                  aria-describedby={
                    errors.defaultPrice ? "error-part-price" : undefined
                  }
                  aria-invalid={!!errors.defaultPrice || undefined}
                  autoComplete="off"
                  className="ps-10 font-mono"
                  id="part-price"
                  min="0"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || PRICE_REGEX.test(val)) {
                      update("defaultPrice", val);
                    }
                  }}
                  placeholder="0"
                  required
                  step="0.01"
                  type="number"
                  value={form.defaultPrice}
                />
                {errors.defaultPrice && (
                  <p
                    className="mt-1.5 rounded-lg bg-error-container px-3 py-1.5 font-bold text-on-error-container text-xs"
                    id="error-part-price"
                    role="alert"
                  >
                    {errors.defaultPrice}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label className="mb-2 block" htmlFor="part-supplier">
                {t("add_part_modal.supplier")}{" "}
                <span className="font-normal text-on-surface-variant text-xs normal-case tracking-normal">
                  ({t("add_part_modal.optional")})
                </span>
              </Label>
              <Input
                autoComplete="off"
                id="part-supplier"
                onChange={(e) => update("supplier", e.target.value)}
                placeholder={t("add_part_modal.supplier_placeholder")}
                value={form.supplier}
              />
            </div>

            <fieldset
              aria-labelledby="active-status-label"
              className="flex items-center justify-between rounded-xl border-none bg-surface-container-low px-4 py-3"
            >
              <div>
                <p
                  className="font-bold text-on-surface text-sm"
                  id="active-status-label"
                >
                  {t("add_part_modal.active_status")}
                </p>
                <p className="text-on-surface-variant text-xs">
                  {t("add_part_modal.active_status_desc")}
                </p>
              </div>
              <Switch
                ariaLabelledBy="active-status-label"
                checked={form.isActive}
                onChange={(val) => update("isActive", val)}
              />
            </fieldset>

            <fieldset
              aria-labelledby="listed-online-label"
              className="flex items-center justify-between rounded-xl border-none bg-surface-container-low px-4 py-3"
            >
              <div>
                <p
                  className="font-bold text-on-surface text-sm"
                  id="listed-online-label"
                >
                  {t("add_part_modal.listed_online")}
                </p>
                <p className="text-on-surface-variant text-xs">
                  {t("add_part_modal.listed_online_desc")}
                </p>
              </div>
              <Switch
                ariaLabelledBy="listed-online-label"
                checked={form.listedOnline}
                onChange={(val) => update("listedOnline", val)}
              />
            </fieldset>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4">
            <Button
              onClick={handleRequestClose}
              type="button"
              variant="secondary"
            >
              {t("add_part_modal.cancel")}
            </Button>
            <Button icon={isEditing ? "check" : "add"} type="submit">
              {isEditing ? t("save") : t("add_part_modal.add_part")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
