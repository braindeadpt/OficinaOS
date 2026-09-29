import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useCustomersStore } from "@/stores/customers";

/**
 * Inline WhatsApp consent toggle for customer lists. Optimistic: flips
 * immediately, rolls back on API failure with an error toast. Opt-in
 * records whatsappConsentAt server-side; revoke clears it. Hovering the
 * toggle shows when consent was granted (opt-in date audit trail).
 */
export default function ConsentToggle({
  customer,
}: {
  customer: {
    id: string;
    name: string;
    whatsappConsent?: boolean;
    whatsappConsentAt?: string | Date | null;
  };
}) {
  const { t, i18n } = useTranslation();
  const updateCustomer = useCustomersStore((s) => s.updateCustomer);
  const [consent, setConsent] = useState(customer.whatsappConsent ?? false);
  const [consentAt, setConsentAt] = useState(
    customer.whatsappConsentAt ?? null
  );
  const [saving, setSaving] = useState(false);

  const handleToggle = useCallback(
    async (next: boolean) => {
      const previous = consent;
      const previousAt = consentAt;
      setConsent(next); // optimistic
      setSaving(true);
      try {
        const updated = await updateCustomer(customer.id, {
          whatsappConsent: next,
        });
        // Sync the tooltip with the server-returned timestamp so the
        // opt-in date shows right away, without waiting for a refetch.
        setConsentAt(updated.whatsappConsentAt ?? null);
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
        setConsentAt(previousAt);
      }
    },
    [consent, consentAt, customer.id, customer.name, updateCustomer, t]
  );

  return (
    <Switch
      ariaLabel={t("customer_consent_toggle_aria", { name: customer.name })}
      checked={consent}
      disabled={saving}
      id={`consent-${customer.id}`}
      onChange={handleToggle}
      title={
        consent && consentAt
          ? t("customer_consent_optin_since", {
              date: new Date(consentAt).toLocaleString(i18n.language),
            })
          : undefined
      }
    />
  );
}
