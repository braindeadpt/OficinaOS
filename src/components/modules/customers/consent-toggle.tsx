import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useCustomersStore } from "@/stores/customers";

/**
 * Inline WhatsApp consent toggle for customer lists. Optimistic: flips
 * immediately, rolls back on API failure with an error toast. Opt-in
 * records whatsappConsentAt server-side; revoke clears it.
 */
export default function ConsentToggle({
  customer,
}: {
  customer: {
    id: string;
    name: string;
    whatsappConsent?: boolean;
  };
}) {
  const { t } = useTranslation();
  const updateCustomer = useCustomersStore((s) => s.updateCustomer);
  const [consent, setConsent] = useState(customer.whatsappConsent ?? false);
  const [saving, setSaving] = useState(false);

  const handleToggle = useCallback(
    async (next: boolean) => {
      const previous = consent;
      setConsent(next); // optimistic
      setSaving(true);
      try {
        await updateCustomer(customer.id, {
          whatsappConsent: next,
        });
        toast.success(
          t(
            next
              ? "customer_consent_optin_toast"
              : "customer_consent_revoke_toast",
            { name: customer.name }
          )
        );
      } catch {
        setConsent(previous); // rollback
      }
    },
    [consent, customer.id, customer.name, updateCustomer, t]
  );

  return (
    <Switch
      ariaLabel={t("customer_consent_toggle_aria", { name: customer.name })}
      checked={consent}
      disabled={saving}
      id={`consent-${customer.id}`}
      onChange={handleToggle}
    />
  );
}
