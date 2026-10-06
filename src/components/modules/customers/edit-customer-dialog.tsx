import type { Customer } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { useCustomersStore } from "@/stores/customers";

interface EditCustomerDialogProps {
  customer: Customer;
  onClose: () => void;
  onSaved: (updated: Customer) => void;
  open: boolean;
}

interface FormData {
  email: string;
  name: string;
  phone: string;
  taxId: string;
  whatsappConsent: boolean;
}

function buildUpdatePayload(
  form: FormData,
  customer: Customer
): Record<string, string> {
  const data: Record<string, string> = {};
  if (form.name.trim() !== customer.name) {
    data.name = form.name.trim();
  }
  if (form.phone.trim() !== customer.phone) {
    data.phone = form.phone.trim();
  }
  if ((form.email.trim() || null) !== (customer.email ?? null)) {
    data.email = form.email.trim();
  }
  if ((form.taxId.trim() || null) !== (customer.taxId ?? null)) {
    data.taxId = form.taxId.trim();
  }
  if (form.whatsappConsent !== (customer.whatsappConsent ?? false)) {
    data.whatsappConsent = String(form.whatsappConsent);
  }
  return data;
}

export default function EditCustomerDialog({
  customer,
  open,
  onClose,
  onSaved,
}: EditCustomerDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormData>({
    email: customer.email ?? "",
    name: customer.name,
    phone: customer.phone,
    taxId: customer.taxId ?? "",
    whatsappConsent: customer.whatsappConsent ?? false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const updateCustomer = useCustomersStore((s) => s.updateCustomer);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useModalEffects(open, onClose, dialogRef);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm({
      email: customer.email ?? "",
      name: customer.name,
      phone: customer.phone,
      taxId: customer.taxId ?? "",
      whatsappConsent: customer.whatsappConsent ?? false,
    });
    setSubmitError(null);
  }, [open, customer]);

  useEffect(() => {
    if (open) {
      nameInputRef.current?.focus();
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!(form.name.trim() && form.phone.trim())) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const data = buildUpdatePayload(form, customer);

      if (Object.keys(data).length === 0) {
        onClose();
        return;
      }

      const updated = await updateCustomer(customer.id, data);
      onSaved(updated);
      onClose();
    } catch {
      setSubmitError(t("errors.update_customer"));
    } finally {
      setSubmitting(false);
    }
  }, [form, customer, updateCustomer, onSaved, onClose, t]);

  if (!open) {
    return null;
  }

  const canSubmit = form.name.trim().length > 0 && form.phone.trim().length > 0;

  return (
    <div
      aria-labelledby="edit-customer-title"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end px-0 sm:items-center sm:justify-center sm:px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
        type="button"
      />
      <div
        className="modal-surface relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-b-none bg-surface-container-lowest shadow-2xl sm:max-h-[80vh] sm:max-w-md sm:rounded-xl"
        ref={dialogRef}
      >
        <div className="flex items-center justify-between px-6 py-4">
          <h2
            className="font-bold font-headline text-lg text-on-surface"
            id="edit-customer-title"
          >
            {t("customer_edit_title")}
          </h2>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            <Field label={t("customer_edit_name")}>
              <Input
                maxLength={120}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
                ref={nameInputRef}
                type="text"
                value={form.name}
              />
            </Field>

            <Field label={t("customer_edit_phone")}>
              <Input
                maxLength={32}
                onChange={(e) =>
                  setForm((p) => ({ ...p, phone: e.target.value }))
                }
                type="tel"
                value={form.phone}
              />
            </Field>

            <Field label={t("customer_edit_email")}>
              <Input
                className="placeholder:text-outline"
                maxLength={254}
                onChange={(e) =>
                  setForm((p) => ({ ...p, email: e.target.value }))
                }
                placeholder="email@example.com"
                type="email"
                value={form.email}
              />
            </Field>

            <Field label={t("customer_edit_tax_id")}>
              <Input
                className="placeholder:text-outline"
                inputMode="numeric"
                maxLength={20}
                onChange={(e) =>
                  setForm((p) => ({ ...p, taxId: e.target.value }))
                }
                placeholder={t("add_customer_modal.tax_id_placeholder")}
                value={form.taxId}
              />
            </Field>

            <Field horizontal label={t("add_customer_modal.whatsapp_consent")}>
              <input
                checked={form.whatsappConsent}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    whatsappConsent: e.target.checked,
                  }))
                }
                type="checkbox"
              />
            </Field>
          </div>
        </div>

        {submitError && (
          <div className="px-6 py-2" role="alert">
            <p className="font-body text-error text-xs">{submitError}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            className="min-h-[44px] px-4 py-2 font-bold font-headline text-on-surface-variant text-sm hover:text-on-surface"
            onClick={onClose}
            type="button"
          >
            {t("customer_edit_cancel")}
          </button>
          <button
            className="min-h-[44px] rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            type="button"
          >
            {submitting ? "..." : t("customer_edit_save")}
          </button>
        </div>
      </div>
    </div>
  );
}
