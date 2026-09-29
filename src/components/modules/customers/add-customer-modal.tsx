import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCustomer } from "@/hooks/use-create-customer";
import { useModalEffects } from "@/hooks/use-modal-effects";

interface AddCustomerModalProps {
  onClose: () => void;
  onSuccess: () => void;
  open: boolean;
}

const INITIAL_FORM = {
  email: "",
  name: "",
  phone: "",
  whatsappConsent: false,
};

type FieldErrors = Partial<Record<keyof typeof INITIAL_FORM, string>>;

function isDirty(form: typeof INITIAL_FORM): boolean {
  return (
    form.name !== INITIAL_FORM.name ||
    form.phone !== INITIAL_FORM.phone ||
    form.email !== INITIAL_FORM.email ||
    form.whatsappConsent !== INITIAL_FORM.whatsappConsent
  );
}

export default function AddCustomerModal({
  onClose,
  onSuccess,
  open,
}: AddCustomerModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(open, onClose, dialogRef);
  const {
    clearError,
    create,
    error: createError,
    isCreating,
  } = useCreateCustomer();

  const [form, setForm] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const updateForm = useCallback(
    <K extends keyof typeof INITIAL_FORM>(key: K, value: string) => {
      setForm((p) => ({ ...p, [key]: value }));
      clearError();
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [clearError]
  );

  useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setErrors({});
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (isDirty(form)) {
      setShowDiscardDialog(true);
      return;
    }
    onClose();
  }, [form, onClose]);

  const handleDiscard = useCallback(() => {
    setShowDiscardDialog(false);
    setForm(INITIAL_FORM);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    const newErrors: FieldErrors = {};
    if (!form.name.trim()) {
      newErrors.name = t("add_customer_modal.error_name_required");
    }
    if (!form.phone.trim()) {
      newErrors.phone = t("add_customer_modal.error_phone_required");
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      await create({
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        whatsappConsent: form.whatsappConsent || undefined,
      });
      setForm(INITIAL_FORM);
      onSuccess();
      onClose();
    } catch {
      // error handled by useCreateCustomer
    }
  }, [form, create, onSuccess, onClose, t]);

  if (!open) {
    return null;
  }

  const nameError = errors.name;
  const phoneError = errors.phone;

  return (
    <div
      aria-labelledby="add-customer-title"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end sm:items-center sm:justify-center"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-on-surface"
        onClick={handleClose}
        type="button"
      />
      <ConfirmDiscardDialog
        onDiscard={handleDiscard}
        onKeepEditing={() => setShowDiscardDialog(false)}
        open={showDiscardDialog}
      />
      <div
        className="modal-surface relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-b-none bg-surface-container-lowest shadow-2xl sm:max-h-[80vh] sm:max-w-md sm:rounded-xl"
        ref={dialogRef}
      >
        <div className="flex items-center justify-between px-6 py-4">
          <h2
            className="font-bold font-headline text-lg text-on-surface"
            id="add-customer-title"
          >
            {t("add_customer_modal.title")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={handleClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="add-customer-name">
                {t("add_customer_modal.name")}
              </Label>
              <Input
                id="add-customer-name"
                onChange={(e) => updateForm("name", e.target.value)}
                value={form.name}
              />
              {nameError && (
                <p className="ms-1 mt-1 text-error text-xs">{nameError}</p>
              )}
            </div>

            <div>
              <Label htmlFor="add-customer-phone">
                {t("add_customer_modal.phone")}
              </Label>
              <Input
                id="add-customer-phone"
                onChange={(e) => updateForm("phone", e.target.value)}
                type="tel"
                value={form.phone}
              />
              {phoneError && (
                <p className="ms-1 mt-1 text-error text-xs">{phoneError}</p>
              )}
            </div>

            <div>
              <Label htmlFor="add-customer-email">
                {t("add_customer_modal.email")}
              </Label>
              <Input
                id="add-customer-email"
                onChange={(e) => updateForm("email", e.target.value)}
                placeholder="email@example.com"
                type="email"
                value={form.email}
              />
            </div>
          </div>

          <label
            className="flex items-start gap-2.5 px-1"
            htmlFor="add-customer-consent"
          >
            <input
              checked={form.whatsappConsent}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              id="add-customer-consent"
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  whatsappConsent: e.target.checked,
                }))
              }
              type="checkbox"
            />
            <span className="font-body text-on-surface-variant text-sm">
              {t("add_customer_modal.whatsapp_consent")}
            </span>
          </label>
        </div>

        {createError && (
          <div className="px-6 py-2" role="alert">
            <p className="text-error text-xs">{createError}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button onClick={handleClose} type="button" variant="ghost">
            {t("add_customer_modal.cancel")}
          </Button>
          <Button
            disabled={isCreating}
            loading={isCreating}
            onClick={handleSubmit}
            type="button"
          >
            {t("add_customer_modal.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
