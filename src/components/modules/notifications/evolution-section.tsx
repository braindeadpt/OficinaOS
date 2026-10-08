import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/stores/settings";

export interface EvolutionFormState {
  disclaimerAccepted: boolean;
  evolutionApiKey: string;
  evolutionInstance: string;
  evolutionUrl: string;
}

interface EvolutionSectionProps {
  disclaimerStored: boolean;
  form: EvolutionFormState;
  hasApiKey: boolean;
  moduleEnabled: boolean;
  onChange: (patch: Partial<EvolutionFormState>) => void;
  savedInstance: string | null;
  savedUrl: string | null;
}

const STATUS_LABEL_KEYS: Record<string, string> = {
  close: "whatsapp_local_status_disconnected",
  connecting: "whatsapp_local_status_connecting",
  open: "whatsapp_local_status_connected",
  unconfigured: "whatsapp_local_status_unconfigured",
  unreachable: "whatsapp_local_status_unreachable",
};

const STATUS_COLORS: Record<string, string> = {
  close: "bg-error/10 text-error",
  connecting: "bg-warning/10 text-warning",
  open: "bg-success/10 text-success",
  unconfigured: "bg-surface-container text-on-surface-variant",
  unreachable: "bg-error/10 text-error",
};

/**
 * WhatsApp local (Evolution API) — config + pairing + health do
 * transporte self-hosted do módulo "whatsapp-bot". O disclaimer é um
 * gate de UI; o servidor revalida disclaimer + entitlement no PUT e no
 * outbox.
 */
export function EvolutionSection({
  disclaimerStored,
  form,
  hasApiKey,
  moduleEnabled,
  onChange,
  savedInstance,
  savedUrl,
}: EvolutionSectionProps) {
  const { t } = useTranslation();
  const pairWhatsAppLocal = useSettingsStore((s) => s.pairWhatsAppLocal);
  const disconnectWhatsAppLocal = useSettingsStore(
    (s) => s.disconnectWhatsAppLocal
  );
  const fetchWhatsAppLocalStatus = useSettingsStore(
    (s) => s.fetchWhatsAppLocalStatus
  );
  const [state, setState] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{
    pairingCode?: string;
    qrBase64?: string;
  } | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const configured = Boolean(savedUrl && hasApiKey);

  const refresh = useCallback(async () => {
    if (!configured) {
      setState(null);
      return;
    }
    const res = await fetchWhatsAppLocalStatus();
    setState(res.state);
    if (res.state === "open") {
      setPairing(null);
    }
  }, [configured, fetchWhatsAppLocalStatus]);

  // Health check: 15s quiet polling while the section is visible — a
  // dropped session must be visible, not silently failing sends.
  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 15_000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [refresh]);

  if (!moduleEnabled) {
    return (
      <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
        {t("whatsapp_module_locked")}
      </p>
    );
  }

  const handlePair = async () => {
    setPairLoading(true);
    setPairingError(null);
    const res = await pairWhatsAppLocal();
    setPairLoading(false);
    if (res.ok) {
      setPairing({ pairingCode: res.pairingCode, qrBase64: res.qrBase64 });
      await refresh();
    } else {
      setPairingError(res.error ?? t("errors.save_shop_settings"));
    }
  };

  const handleDisconnect = async () => {
    await disconnectWhatsAppLocal();
    await refresh();
  };

  const disclaimerAccepted = disclaimerStored || form.disclaimerAccepted;
  const statusKey = state ? STATUS_LABEL_KEYS[state] : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-error/40 bg-error/5 p-4">
        <p className="text-on-surface text-xs leading-relaxed">
          {t("whatsapp_local_disclaimer")}
        </p>
        <div className="mt-3 flex items-center gap-1">
          <Checkbox
            checked={disclaimerAccepted}
            disabled={disclaimerStored}
            id="wa-local-disclaimer"
            onChange={(e) => onChange({ disclaimerAccepted: e.target.checked })}
          />
          <Label
            className="cursor-pointer select-none font-medium text-sm"
            htmlFor="wa-local-disclaimer"
          >
            {t("whatsapp_local_disclaimer_accept")}
          </Label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("whatsapp_local_url")}>
          <Input
            onChange={(e) => onChange({ evolutionUrl: e.target.value })}
            placeholder="http://evolution:8080"
            type="url"
            value={form.evolutionUrl}
          />
        </Field>
        <Field label={t("whatsapp_local_instance")}>
          <Input
            onChange={(e) => onChange({ evolutionInstance: e.target.value })}
            placeholder={savedInstance ?? "oficinaos"}
            value={form.evolutionInstance}
          />
        </Field>
      </div>
      <Field label={t("whatsapp_local_api_key")}>
        <Input
          autoComplete="off"
          onChange={(e) => onChange({ evolutionApiKey: e.target.value })}
          placeholder={hasApiKey ? "••••••••" : ""}
          type="password"
          value={form.evolutionApiKey}
        />
      </Field>

      {configured && statusKey && (
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 font-medium text-xs ${STATUS_COLORS[state ?? "unconfigured"]}`}
          >
            {t(statusKey)}
          </span>
          {state !== "open" && (
            <Button
              className="flex min-h-11"
              loading={pairLoading}
              onClick={handlePair}
              size="sm"
              variant="secondary"
            >
              {t("whatsapp_local_pair")}
            </Button>
          )}
          {state === "open" && (
            <Button
              className="flex min-h-11"
              onClick={handleDisconnect}
              size="sm"
              variant="secondary"
            >
              {t("whatsapp_local_disconnect")}
            </Button>
          )}
        </div>
      )}

      {pairingError && <p className="text-error text-xs">{pairingError}</p>}

      {pairing && (
        <div className="space-y-3 rounded-xl bg-surface-container p-4">
          <p className="text-on-surface-variant text-xs">
            {t("whatsapp_local_pairing_hint")}
          </p>
          {pairing.qrBase64 && (
            <img
              alt="WhatsApp QR"
              className="mx-auto w-52 rounded-lg"
              height={208}
              src={pairing.qrBase64}
              width={208}
            />
          )}
          {pairing.pairingCode && (
            <p className="text-center font-mono font-semibold text-lg tracking-widest">
              {pairing.pairingCode}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
