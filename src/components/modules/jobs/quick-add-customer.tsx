import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCreateCustomer } from "@/hooks/use-create-customer";

export interface CustomerFormData {
  email: string;
  name: string;
  phone: string;
}

export interface CreatedCustomerData extends CustomerFormData {
  id: string;
}

interface QuickAddCustomerProps {
  onAdd: (data: CreatedCustomerData) => void;
  onClose: () => void;
}

export default function QuickAddCustomer({
  onAdd,
  onClose,
}: QuickAddCustomerProps) {
  const { t } = useTranslation();
  const { clearError, create, error, isCreating } = useCreateCustomer();
  const [form, setForm] = useState<CustomerFormData>({
    email: "",
    name: "",
    phone: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof CustomerFormData, string>>
  >({});

  const update = useCallback(
    <K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      clearError();
    },
    [clearError]
  );

  const validate = useCallback((): boolean => {
    const errs: Partial<Record<keyof CustomerFormData, string>> = {};
    if (!form.name.trim()) {
      errs.name = t("intake.error_required");
    }
    if (!form.phone.trim()) {
      errs.phone = t("intake.error_required");
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form, t]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) {
      return;
    }
    try {
      const customer = await create({
        email: form.email,
        name: form.name,
        phone: form.phone,
      });
      onAdd({
        email: customer.email ?? "",
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
      });
    } catch {
      // error is set in the hook
    }
  }, [form, validate, create, onAdd]);

  return (
    <section className="relative">
      <div className="rounded-xl bg-surface-container-lowest p-6 ring-1 ring-outline-variant">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">
              person_add
            </span>
            <h2 className="font-bold font-headline text-primary text-sm">
              {t("intake.new_customer")}
            </h2>
          </div>
          <button
            className="group flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined text-on-surface-variant transition-colors group-hover:text-on-surface">
              close
            </span>
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-error-container px-4 py-3">
            <span className="material-symbols-outlined text-on-error-container text-sm">
              error
            </span>
            <p className="font-bold font-label text-on-error-container text-xs">
              {error}
            </p>
          </div>
        )}

        <div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field
              className="md:col-span-2"
              error={fieldErrors.name}
              label={t("intake.full_name")}
              required
            >
              <Input
                className="font-body placeholder:text-outline/50"
                disabled={isCreating}
                iconStart="person"
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("intake.full_name_placeholder")}
                type="text"
                value={form.name}
              />
            </Field>

            <Field error={fieldErrors.phone} label={t("intake.phone")} required>
              <Input
                className="font-body placeholder:text-outline/50"
                disabled={isCreating}
                iconStart="phone"
                onChange={(e) => update("phone", e.target.value)}
                placeholder="+351..."
                type="tel"
                value={form.phone}
              />
            </Field>

            <Field label={t("intake.email")}>
              <Input
                className="font-body placeholder:text-outline/50"
                disabled={isCreating}
                iconStart="mail"
                onChange={(e) => update("email", e.target.value)}
                placeholder="email@example.com"
                type="email"
                value={form.email}
              />
            </Field>
          </div>

          <div className="mt-8 flex justify-end">
            <button
              className="flex h-12 items-center gap-2 rounded-xl bg-primary px-6 font-bold font-headline text-on-primary text-sm transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isCreating}
              onClick={handleSubmit}
              type="button"
            >
              {isCreating ? (
                <span className="material-symbols-outlined animate-spin text-sm">
                  progress_activity
                </span>
              ) : (
                <span className="material-symbols-outlined text-sm">check</span>
              )}
              {isCreating
                ? t("intake.creating_customer")
                : t("intake.add_customer")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
