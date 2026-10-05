import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import api, { getErrorMessage } from "@/lib/api";

interface InvoicingStatus {
  account: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  module: boolean;
  taxName: string;
}

const TAX_NAMES = ["IVA23", "IVA13", "IVA6", "IVA0"] as const;

export default function SettingsInvoicingSection({
  onToast,
}: {
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<InvoicingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [account, setAccount] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [taxName, setTaxName] = useState("IVA23");

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<InvoicingStatus>("/settings/invoicing");
      setStatus(res.data);
      setEnabled(res.data.enabled);
      setAccount(res.data.account ?? "");
      setTaxName(res.data.taxName || "IVA23");
      setApiKey("");
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => null);
  }, [refresh]);

  async function handleSave() {
    setBusy(true);
    try {
      await api.put("/settings/invoicing", {
        account,
        enabled,
        taxName,
        ...(apiKey ? { apiKey } : {}),
      });
      await refresh();
      onToast(t("invoicing.saved"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("invoicing.save_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.module) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface-container-low p-4">
      <div>
        <div className="font-semibold text-on-surface text-sm">
          {t("invoicing.title")}
        </div>
        <p className="text-on-surface-variant text-xs">
          {t("invoicing.subtitle")}
        </p>
      </div>

      <Field label={t("invoicing.account")}>
        <Input
          autoComplete="off"
          onChange={(e) => setAccount(e.target.value)}
          placeholder={t("invoicing.account_placeholder")}
          value={account}
        />
      </Field>

      <Field label={t("invoicing.api_key")}>
        <div>
          <Input
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              status.hasApiKey
                ? t("invoicing.api_key_set")
                : t("invoicing.api_key_placeholder")
            }
            type="password"
            value={apiKey}
          />
          <p className="mt-1 text-on-surface-variant text-xs">
            {t("invoicing.api_key_hint")}
          </p>
        </div>
      </Field>

      <Field label={t("invoicing.tax_name")}>
        <Select onChange={(e) => setTaxName(e.target.value)} value={taxName}>
          {TAX_NAMES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex items-center justify-between">
        <p
          className="font-medium text-on-surface text-sm"
          id="invoicing-enabled-label"
        >
          {t("invoicing.enabled")}
        </p>
        <Switch
          ariaLabelledBy="invoicing-enabled-label"
          checked={enabled}
          onChange={setEnabled}
        />
      </div>

      <div className="flex justify-end">
        <Button disabled={busy} icon="save" onClick={handleSave}>
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
