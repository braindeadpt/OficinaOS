import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/stores/settings";
import { EvolutionSection } from "./evolution-section";

type Store = ReturnType<typeof useSettingsStore.getState>;

interface ChannelSettingsProps {
  onFetchWhatsAppSettings: () => Promise<void>;
  onRegisterSmsWebhook: () => Promise<{ ok: boolean; message?: string }>;
  onSaveSmsSettings: (data: {
    enabled?: boolean;
    gatewayPassword?: string;
    gatewayUrl?: string;
    gatewayUser?: string;
  }) => Promise<{ webhookRegistered: boolean }>;
  onSaveWhatsAppSettings: (data: {
    apiToken?: string;
    businessId?: string;
    phoneNumberId?: string;
    enabled?: boolean;
    trackingBaseUrl?: string;
    remarketingEnabled?: boolean;
    remarketingDays?: number;
    remarketingCooldownDays?: number;
    remarketingTemplate?: string;
    pickupReminderTemplate?: string;
    transport?: "meta" | "evolution";
    evolutionUrl?: string;
    evolutionInstance?: string;
    evolutionApiKey?: string;
    disclaimerAccepted?: boolean;
  }) => Promise<void>;
  onSendSmsTest: (phone?: string) => Promise<{ ok: boolean; message?: string }>;
  smsSettings: Store["smsSettings"];
  whatsAppSettings: Store["whatsAppSettings"];
}

function SmsCard({
  smsSettings,
  onSave,
  onSendTest,
  onRegisterWebhook,
}: {
  onRegisterWebhook: () => Promise<{ ok: boolean; message?: string }>;
  onSave: ChannelSettingsProps["onSaveSmsSettings"];
  onSendTest: ChannelSettingsProps["onSendSmsTest"];
  smsSettings: Store["smsSettings"];
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    enabled: false,
    gatewayPassword: "",
    gatewayUrl: "",
    gatewayUser: "",
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const smsCloudDevice = useSettingsStore((s) => s.smsCloudDevice);
  const fetchSmsCloudDevice = useSettingsStore((s) => s.fetchSmsCloudDevice);

  useEffect(() => {
    fetchSmsCloudDevice();
  }, [fetchSmsCloudDevice]);

  useEffect(() => {
    if (smsSettings && !loaded) {
      setForm((f) => ({
        ...f,
        enabled: smsSettings.enabled,
        gatewayUrl: smsSettings.gatewayUrl ?? "",
        gatewayUser: smsSettings.gatewayUser ?? "",
      }));
      setLoaded(true);
    }
  }, [smsSettings, loaded]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { webhookRegistered } = await onSave({
        enabled: form.enabled,
        gatewayPassword: form.gatewayPassword || undefined,
        gatewayUrl: form.gatewayUrl,
        gatewayUser: form.gatewayUser,
      });
      if (form.enabled && !webhookRegistered) {
        toast.warning(t("sms_webhook_not_registered"));
      }
      setForm((f) => ({ ...f, gatewayPassword: "" }));
    } catch {
      // Error is stored in Zustand state
    } finally {
      setSaving(false);
    }
  }, [form, onSave, t]);

  const handleTest = useCallback(async () => {
    const res = await onSendTest();
    if (res.ok) {
      toast.success(t("sms_test_sent"));
    } else if (res.message) {
      toast.error(res.message);
    }
  }, [onSendTest, t]);

  const handleRegister = useCallback(async () => {
    const res = await onRegisterWebhook();
    if (res.ok) {
      toast.success(t("sms_webhook_registered"));
    } else {
      toast.error(res.message ?? t("sms_webhook_not_registered"));
    }
  }, [onRegisterWebhook, t]);

  const inboundUrl = smsSettings?.inboundPath
    ? `${window.location.origin}${smsSettings.inboundPath}`
    : null;
  // O gateway Android local é free — o módulo "sms" gateia apenas os
  // transportes geridos futuros, por isso nunca bloqueia este card.
  return (
    <div className="mt-6">
      <h3 className="font-extrabold font-headline text-lg text-on-surface tracking-tight">
        {t("sms_settings")}
      </h3>
      <div className="mt-4 rounded-2xl bg-surface-container-low p-5">
        <div className="flex items-center gap-3">
          <Switch
            ariaLabelledBy="sms-enabled-label"
            checked={form.enabled}
            onChange={(checked) => setForm((f) => ({ ...f, enabled: checked }))}
          />
          <span
            className="font-medium text-on-surface text-sm"
            id="sms-enabled-label"
          >
            {t("sms_enabled")}
          </span>
        </div>
        <p className="mt-2 text-on-surface-variant text-xs">{t("sms_desc")}</p>

        <div className="mt-3 rounded-xl bg-surface-container px-3 py-2.5">
          <p className="font-medium text-on-surface text-xs">
            {t("sms_setup_title")}
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-on-surface-variant text-xs">
            <li>{t("sms_setup_1")}</li>
            <li>{t("sms_setup_2")}</li>
            <li>{t("sms_setup_3")}</li>
            <li>{t("sms_setup_4")}</li>
            <li>{t("sms_setup_5")}</li>
          </ol>
          <p className="mt-2 text-on-surface-variant text-xs italic">
            {t("sms_setup_tip")}
          </p>
        </div>

        {form.enabled && (
          <div className="mt-5 space-y-4">
            <Field
              hint={t("sms_gateway_url_hint")}
              label={t("sms_gateway_url")}
            >
              <Input
                onChange={(e) =>
                  setForm((f) => ({ ...f, gatewayUrl: e.target.value }))
                }
                placeholder="http://192.168.1.50:8080"
                type="url"
                value={form.gatewayUrl}
              />
            </Field>
            <Field label={t("sms_gateway_user")}>
              <Input
                autoComplete="off"
                onChange={(e) =>
                  setForm((f) => ({ ...f, gatewayUser: e.target.value }))
                }
                value={form.gatewayUser}
              />
            </Field>
            <Field
              hint={t("sms_gateway_password_hint")}
              label={t("sms_gateway_password")}
            >
              <Input
                autoComplete="new-password"
                onChange={(e) =>
                  setForm((f) => ({ ...f, gatewayPassword: e.target.value }))
                }
                placeholder={smsSettings?.hasPassword ? "••••••••" : ""}
                type="password"
                value={form.gatewayPassword}
              />
            </Field>

            {inboundUrl && (
              <Field
                hint={t("sms_inbound_url_hint")}
                label={t("sms_inbound_url")}
              >
                <Input readOnly value={inboundUrl} />
              </Field>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                className="flex min-h-11"
                disabled={saving}
                loading={saving}
                onClick={handleSave}
                size="sm"
              >
                {saving ? t("settings_saving") : t("save_changes")}
              </Button>
              <Button
                className="flex min-h-11"
                onClick={handleTest}
                size="sm"
                variant="secondary"
              >
                {t("sms_send_test")}
              </Button>
              <Button
                className="flex min-h-11"
                onClick={handleRegister}
                size="sm"
                variant="secondary"
              >
                {t("sms_register_webhook")}
              </Button>
            </div>
          </div>
        )}

        {smsCloudDevice?.entitled && (
          <div className="mt-5 rounded-xl bg-surface-container px-3 py-2.5">
            <p className="font-medium text-on-surface text-xs">
              {t("sms_pro_title")}
            </p>
            {smsCloudDevice.configured && smsCloudDevice.device ? (
              <div className="mt-1.5 space-y-1 text-on-surface-variant text-xs">
                <p>
                  {smsCloudDevice.device.label}
                  {smsCloudDevice.device.phoneE164
                    ? ` · ${smsCloudDevice.device.phoneE164}`
                    : ""}
                  {" — "}
                  {smsCloudDevice.device.offline
                    ? t("sms_pro_offline")
                    : t("sms_pro_online")}
                </p>
                <p className="break-all">
                  {t("sms_pro_webhook")}: {smsCloudDevice.device.webhookUrl}
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-on-surface-variant text-xs">
                {smsCloudDevice.reachable
                  ? t("sms_pro_not_configured")
                  : t("sms_pro_unreachable")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Campos do transporte oficial Meta (IDs, token, relay, remarketing). */
function MetaWhatsAppFields({
  form,
  settings,
  setForm,
}: {
  form: WhatsAppFormState;
  settings: Store["whatsAppSettings"];
  setForm: React.Dispatch<React.SetStateAction<WhatsAppFormState>>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <label
            className="mb-1.5 block font-medium text-on-surface text-sm"
            htmlFor="wa-business-id"
          >
            {t("whatsapp_business_id")}
          </label>
          <span
            className="material-symbols-outlined mb-1.5 cursor-help text-on-surface-variant text-xs"
            title={t(
              "whatsapp_business_id_help",
              "Your WhatsApp Business Account ID from Meta Business Manager"
            )}
          >
            help
          </span>
        </div>
        <input
          className="min-h-11 w-full rounded-xl bg-surface-container px-4 py-2.5 text-on-surface text-sm focus:bg-surface-container-lowest"
          id="wa-business-id"
          onChange={(e) =>
            setForm((f) => ({ ...f, businessId: e.target.value }))
          }
          type="text"
          value={form.businessId}
        />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <label
            className="mb-1.5 block font-medium text-on-surface text-sm"
            htmlFor="wa-phone-id"
          >
            {t("whatsapp_phone_number_id")}
          </label>
          <span
            className="material-symbols-outlined mb-1.5 cursor-help text-on-surface-variant text-xs"
            title={t(
              "whatsapp_phone_id_help",
              "Your registered phone number ID from WhatsApp Business API"
            )}
          >
            help
          </span>
        </div>
        <input
          className="min-h-11 w-full rounded-xl bg-surface-container px-4 py-2.5 text-on-surface text-sm focus:bg-surface-container-lowest"
          id="wa-phone-id"
          onChange={(e) =>
            setForm((f) => ({ ...f, phoneNumberId: e.target.value }))
          }
          type="text"
          value={form.phoneNumberId}
        />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <label
            className="mb-1.5 block font-medium text-on-surface text-sm"
            htmlFor="wa-api-token"
          >
            {t("whatsapp_api_token")}
          </label>
          <span
            className="material-symbols-outlined mb-1.5 cursor-help text-on-surface-variant text-xs"
            title={t(
              "whatsapp_api_token_help",
              "Your permanent access token from Meta Developers dashboard"
            )}
          >
            help
          </span>
        </div>
        <input
          autoComplete="off"
          className="min-h-11 w-full rounded-xl bg-surface-container px-4 py-2.5 text-on-surface text-sm focus:bg-surface-container-lowest"
          id="wa-api-token"
          onChange={(e) => setForm((f) => ({ ...f, apiToken: e.target.value }))}
          placeholder={settings?.hasApiToken ? "••••••••" : ""}
          type="password"
          value={form.apiToken}
        />
      </div>
      {settings?.credentialsAtCloud ? (
        <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
          {t("whatsapp_relay_active")}
        </p>
      ) : (
        settings?.hasApiToken && (
          <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
            {t("whatsapp_relay_pending")}
          </p>
        )
      )}
      {settings?.remarketingModule ? (
        <div className="rounded-xl bg-surface-container p-4">
          <div className="flex items-center gap-3">
            <Switch
              ariaLabelledBy="remarketing-enabled-label"
              checked={form.remarketingEnabled}
              onChange={(checked) =>
                setForm((f) => ({ ...f, remarketingEnabled: checked }))
              }
            />
            <span
              className="font-medium text-on-surface text-sm"
              id="remarketing-enabled-label"
            >
              {t("remarketing_enabled")}
            </span>
          </div>
          <p className="mt-2 text-on-surface-variant text-xs">
            {t("remarketing_desc")}
          </p>

          {form.remarketingEnabled && (
            <div className="mt-4 space-y-3">
              <Field
                hint={t("remarketing_days_hint")}
                label={t("remarketing_days")}
              >
                <Input
                  inputMode="numeric"
                  max={365}
                  min={30}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, remarketingDays: e.target.value }))
                  }
                  type="number"
                  value={form.remarketingDays}
                />
              </Field>
              <Field
                hint={t("remarketing_cooldown_hint")}
                label={t("remarketing_cooldown")}
              >
                <Input
                  inputMode="numeric"
                  max={365}
                  min={30}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      remarketingCooldownDays: e.target.value,
                    }))
                  }
                  type="number"
                  value={form.remarketingCooldownDays}
                />
              </Field>
              <Field
                hint={t("remarketing_template_hint")}
                label={t("remarketing_template")}
              >
                <Input
                  autoComplete="off"
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      remarketingTemplate: e.target.value,
                    }))
                  }
                  placeholder="oficinaos_remarketing"
                  value={form.remarketingTemplate}
                />
              </Field>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
          {t("remarketing_upsell")}
        </p>
      )}
      <Field
        hint={t("pickup_reminder_template_hint")}
        label={t("pickup_reminder_template")}
      >
        <Input
          autoComplete="off"
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              pickupReminderTemplate: e.target.value,
            }))
          }
          placeholder="oficinaos_pickup_reminder"
          value={form.pickupReminderTemplate}
        />
      </Field>
      <WaTemplatesBlock />
    </>
  );
}

const WA_TPL_STATUS_KEYS: Record<string, string> = {
  APPROVED: "wa_tpl_status_approved",
  IN_REVIEW: "wa_tpl_status_in_review",
  MISSING: "wa_tpl_status_missing",
  PENDING: "wa_tpl_status_pending",
  REJECTED: "wa_tpl_status_rejected",
};

const WA_TPL_CHIP_CLASS: Record<string, string> = {
  APPROVED: "bg-success-container text-on-success-container",
  MISSING: "bg-error-container text-on-error-container",
  REJECTED: "bg-error-container text-on-error-container",
};

/**
 * Estado do sync de templates Meta (§5.6): um chip por template com o
 * estado que a Meta/Cloud devolveu e um botão "Voltar a submeter" que
 * corre o sync outra vez — para os rejeitados/em falta depois de
 * corrigir o texto.
 */
function WaTemplatesBlock() {
  const { t } = useTranslation();
  const waTemplates = useSettingsStore((s) => s.waTemplates);
  const fetchWaTemplates = useSettingsStore((s) => s.fetchWaTemplates);
  const syncWaTemplates = useSettingsStore((s) => s.syncWaTemplates);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchWaTemplates();
  }, [fetchWaTemplates]);

  const handleResync = async () => {
    setSyncing(true);
    try {
      const res = await syncWaTemplates();
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(
          t("wa_tpl_sync_done", {
            ready: res.ready,
            total: res.total,
          })
        );
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface-container p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-on-surface text-sm">
          {t("wa_tpl_title")}
        </p>
        <Button loading={syncing} onClick={handleResync} size="sm">
          {t("wa_tpl_resubmit")}
        </Button>
      </div>
      <p className="mt-1 text-on-surface-variant text-xs">{t("wa_tpl_desc")}</p>
      {waTemplates.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {waTemplates.map((tpl) => (
            <li
              className="flex items-center justify-between gap-2 text-xs"
              key={tpl.name}
            >
              <span className="truncate font-mono text-on-surface">
                {tpl.name}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 ${
                  WA_TPL_CHIP_CLASS[tpl.status] ??
                  "bg-surface-container-high text-on-surface-variant"
                }`}
                title={tpl.reason}
              >
                {t(WA_TPL_STATUS_KEYS[tpl.status] ?? "wa_tpl_status_pending")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface WhatsAppFormState {
  apiToken: string;
  businessId: string;
  disclaimerAccepted: boolean;
  enabled: boolean;
  evolutionApiKey: string;
  evolutionInstance: string;
  evolutionUrl: string;
  phoneNumberId: string;
  pickupReminderTemplate: string;
  remarketingCooldownDays: string;
  remarketingDays: string;
  remarketingEnabled: boolean;
  remarketingTemplate: string;
  trackingBaseUrl: string;
  transport: "meta" | "evolution";
}

/**
 * "O que o bot pode dizer" — ficha da loja para o bot de IA (Pro).
 * Feeds POST /ai/bot-reply's shopCard; kept in shop settings (not the
 * WhatsApp settings object) because all channels share it.
 */
function BotCard() {
  const { t } = useTranslation();
  const shopSettings = useSettingsStore((s) => s.shopSettings);
  const saveShopSettings = useSettingsStore((s) => s.saveShopSettings);
  const [form, setForm] = useState({
    avgDays: "1",
    enabled: false,
    fallback: "",
    info: "",
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (shopSettings && !loaded) {
      setForm({
        avgDays: String(shopSettings.botAvgRepairDaysAfterPart ?? 1),
        enabled: shopSettings.botAiEnabled ?? false,
        fallback: shopSettings.botClosedFallbackText ?? "",
        info: shopSettings.botInfoText ?? "",
      });
      setLoaded(true);
    }
  }, [shopSettings, loaded]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await saveShopSettings({
        botAiEnabled: form.enabled,
        botAvgRepairDaysAfterPart:
          form.avgDays.trim() === ""
            ? 1
            : Math.max(0, Number.parseInt(form.avgDays, 10) || 0),
        botClosedFallbackText: form.fallback || null,
        botInfoText: form.info || null,
      });
    } finally {
      setSaving(false);
    }
  }, [form, saveShopSettings]);

  return (
    <div className="mt-4 rounded-2xl bg-surface-container-low p-5">
      <div className="flex select-none items-center gap-3">
        <Switch
          ariaLabel={t("bot_ai_enabled")}
          checked={form.enabled}
          onChange={(enabled) => setForm((f) => ({ ...f, enabled }))}
        />
        <span className="font-medium text-on-surface text-sm">
          {t("bot_ai_enabled")}
        </span>
      </div>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("bot_ai_enabled_help")}
      </p>

      <div className="mt-4 space-y-4">
        <Field hint={t("bot_info_text_help")} label={t("bot_info_text_label")}>
          <Textarea
            onChange={(e) => setForm((f) => ({ ...f, info: e.target.value }))}
            placeholder={t("bot_info_text_placeholder")}
            rows={4}
            value={form.info}
          />
        </Field>
        <Field hint={t("bot_avg_days_help")} label={t("bot_avg_days_label")}>
          <Input
            min={0}
            onChange={(e) =>
              setForm((f) => ({ ...f, avgDays: e.target.value }))
            }
            type="number"
            value={form.avgDays}
          />
        </Field>
        <Field
          hint={t("bot_fallback_text_help")}
          label={t("bot_fallback_text_label")}
        >
          <Textarea
            onChange={(e) =>
              setForm((f) => ({ ...f, fallback: e.target.value }))
            }
            placeholder={t("bot_fallback_text_placeholder")}
            rows={2}
            value={form.fallback}
          />
        </Field>
        <Button
          className="flex min-h-11"
          disabled={saving}
          loading={saving}
          onClick={handleSave}
          size="sm"
        >
          {saving ? t("settings_saving") : t("save_changes")}
        </Button>
      </div>
    </div>
  );
}

export default function ChannelSettings({
  smsSettings,
  whatsAppSettings,
  onFetchWhatsAppSettings,
  onRegisterSmsWebhook,
  onSaveSmsSettings,
  onSaveWhatsAppSettings,
  onSendSmsTest,
}: ChannelSettingsProps) {
  const { t } = useTranslation();
  const [whatsAppForm, setWhatsAppForm] = useState<WhatsAppFormState>({
    apiToken: "",
    businessId: "",
    phoneNumberId: "",
    trackingBaseUrl: "",
    enabled: false,
    remarketingEnabled: false,
    remarketingDays: "90",
    remarketingCooldownDays: "180",
    remarketingTemplate: "oficinaos_remarketing",
    pickupReminderTemplate: "oficinaos_pickup_reminder",
    transport: "meta",
    evolutionUrl: "",
    evolutionInstance: "",
    evolutionApiKey: "",
    disclaimerAccepted: false,
  });
  const [whatsAppSaving, setWhatsAppSaving] = useState(false);
  const [whatsAppLoaded, setWhatsAppLoaded] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!whatsAppLoaded) {
      onFetchWhatsAppSettings()
        .catch(() => {
          setFetchError(t("settings_fetch_failed"));
        })
        .finally(() => {
          setWhatsAppLoaded(true);
        });
    }
  }, [whatsAppLoaded, onFetchWhatsAppSettings, t]);

  useEffect(() => {
    if (whatsAppSettings && !whatsAppSaving) {
      setWhatsAppForm((prev) => ({
        apiToken: prev.apiToken || "",
        businessId: whatsAppSettings.businessId ?? "",
        phoneNumberId: whatsAppSettings.phoneNumberId ?? "",
        trackingBaseUrl: whatsAppSettings.trackingBaseUrl ?? "",
        enabled: whatsAppSettings.enabled,
        remarketingEnabled: whatsAppSettings.remarketingEnabled,
        remarketingDays: String(whatsAppSettings.remarketingDays ?? 90),
        remarketingCooldownDays: String(
          whatsAppSettings.remarketingCooldownDays ?? 180
        ),
        remarketingTemplate:
          whatsAppSettings.remarketingTemplate ?? "oficinaos_remarketing",
        pickupReminderTemplate: whatsAppSettings.pickupReminderTemplate ?? "",
        transport: whatsAppSettings.transport ?? "meta",
        evolutionUrl: whatsAppSettings.evolutionUrl ?? "",
        evolutionInstance: whatsAppSettings.evolutionInstance ?? "",
        evolutionApiKey: prev.evolutionApiKey || "",
        disclaimerAccepted: false,
      }));
    }
  }, [whatsAppSettings, whatsAppSaving]);

  const handleWhatsAppSave = useCallback(async () => {
    setWhatsAppSaving(true);
    try {
      await onSaveWhatsAppSettings({
        apiToken: whatsAppForm.apiToken || undefined,
        businessId: whatsAppForm.businessId || undefined,
        phoneNumberId: whatsAppForm.phoneNumberId || undefined,
        enabled: whatsAppForm.enabled,
        trackingBaseUrl: whatsAppForm.trackingBaseUrl,
        pickupReminderTemplate: whatsAppForm.pickupReminderTemplate,
        ...(whatsAppSettings?.remarketingModule
          ? {
              remarketingEnabled: whatsAppForm.remarketingEnabled,
              remarketingDays:
                Number.parseInt(whatsAppForm.remarketingDays, 10) || 90,
              remarketingCooldownDays:
                Number.parseInt(whatsAppForm.remarketingCooldownDays, 10) ||
                180,
              remarketingTemplate: whatsAppForm.remarketingTemplate,
            }
          : {}),
        transport: whatsAppForm.transport,
        ...(whatsAppForm.transport === "evolution"
          ? {
              evolutionUrl: whatsAppForm.evolutionUrl,
              evolutionInstance: whatsAppForm.evolutionInstance,
              evolutionApiKey: whatsAppForm.evolutionApiKey || undefined,
              disclaimerAccepted: whatsAppForm.disclaimerAccepted,
            }
          : {}),
      });
    } catch {
      // Error is stored in Zustand state
    } finally {
      setWhatsAppSaving(false);
    }
  }, [
    whatsAppForm,
    onSaveWhatsAppSettings,
    whatsAppSettings?.remarketingModule,
  ]);

  return (
    <div>
      <h3 className="font-extrabold font-headline text-lg text-on-surface tracking-tight">
        {t("whatsapp_settings")}
      </h3>
      {fetchError && <p className="mt-2 text-error text-sm">{fetchError}</p>}
      <div className="mt-4 rounded-2xl bg-surface-container-low p-5">
        <label className="flex cursor-pointer select-none items-center gap-3">
          <input
            checked={whatsAppForm.enabled}
            className="sr-only"
            onChange={(e) =>
              setWhatsAppForm((f) => ({ ...f, enabled: e.target.checked }))
            }
            type="checkbox"
          />
          <span
            className="relative inline-block h-6 w-11 rounded-full transition-colors"
            style={{
              backgroundColor: whatsAppForm.enabled
                ? "var(--color-primary)"
                : "var(--color-outline-variant)",
            }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-on-primary shadow-sm transition-all"
              style={{
                insetInlineStart: whatsAppForm.enabled ? "22px" : "2px",
              }}
            />
          </span>
          <span className="font-medium text-on-surface text-sm">
            {t("whatsapp_enabled")}
          </span>
        </label>

        {whatsAppForm.enabled && (
          <div className="mt-5 space-y-4">
            <Field label={t("whatsapp_transport")}>
              <Select
                onChange={(e) =>
                  setWhatsAppForm((f) => ({
                    ...f,
                    transport: e.target.value as "meta" | "evolution",
                  }))
                }
                value={whatsAppForm.transport}
              >
                <option value="meta">{t("whatsapp_transport_meta")}</option>
                <option value="evolution">
                  {t("whatsapp_transport_local")}
                </option>
              </Select>
            </Field>
            <Field
              hint={t(
                "whatsapp_tracking_url_help",
                "Public address where customers open the tracking page from WhatsApp messages, e.g. https://repairs.myshop.com or http://192.168.1.33:4000. Optional — the link is only included when set"
              )}
              label={t("whatsapp_tracking_url")}
            >
              <Input
                onChange={(e) =>
                  setWhatsAppForm((f) => ({
                    ...f,
                    trackingBaseUrl: e.target.value,
                  }))
                }
                placeholder="https://"
                type="url"
                value={whatsAppForm.trackingBaseUrl}
              />
            </Field>
            {whatsAppForm.transport === "evolution" ? (
              <EvolutionSection
                disclaimerStored={whatsAppSettings?.disclaimerAccepted ?? false}
                form={whatsAppForm}
                hasApiKey={whatsAppSettings?.hasEvolutionApiKey ?? false}
                onChange={(patch) =>
                  setWhatsAppForm((f) => ({ ...f, ...patch }))
                }
                savedInstance={whatsAppSettings?.evolutionInstance ?? null}
                savedUrl={whatsAppSettings?.evolutionUrl ?? null}
              />
            ) : (
              <MetaWhatsAppFields
                form={whatsAppForm}
                setForm={setWhatsAppForm}
                settings={whatsAppSettings}
              />
            )}

            <Button
              className="flex min-h-11"
              disabled={
                whatsAppSaving ||
                (whatsAppForm.transport === "evolution" &&
                  !(
                    whatsAppForm.disclaimerAccepted ||
                    whatsAppSettings?.disclaimerAccepted
                  ))
              }
              loading={whatsAppSaving}
              onClick={handleWhatsAppSave}
              size="sm"
            >
              {whatsAppSaving ? t("settings_saving") : t("save_changes")}
            </Button>
          </div>
        )}
      </div>

      <SmsCard
        onRegisterWebhook={onRegisterSmsWebhook}
        onSave={onSaveSmsSettings}
        onSendTest={onSendSmsTest}
        smsSettings={smsSettings}
      />
      <BotCard />
    </div>
  );
}
