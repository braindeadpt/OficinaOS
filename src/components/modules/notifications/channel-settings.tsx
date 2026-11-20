import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { useSettingsStore } from "@/stores/settings";
import { EvolutionSection } from "./evolution-section";

type Store = ReturnType<typeof useSettingsStore.getState>;

interface ChannelSettingsProps {
  onFetchWhatsAppSettings: () => Promise<void>;
  onRegisterSmsWebhook: () => Promise<{ ok: boolean; message?: string }>;
  onSaveSmsSettings: Store["saveSmsSettings"];
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

interface SmsFormState {
  bulksmsTokenId: string;
  bulksmsTokenSecret: string;
  cloudSender: string;
  customBodyFormat: "form" | "json";
  customBodyTemplate: string;
  customHeaders: string;
  customMethod: "GET" | "POST";
  customSuccessText: string;
  customUrl: string;
  enabled: boolean;
  gatewayPassword: string;
  gatewayUrl: string;
  gatewayUser: string;
  transport: "android" | "cloud" | "custom";
}

/** Secção do transporte "android" — sms-gate Local Server na LAN (free). */
function SmsAndroidFields({
  form,
  inboundUrl,
  setForm,
  t,
}: {
  form: SmsFormState;
  inboundUrl: string | null;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
  t: (key: string) => string;
}) {
  return (
    <>
      <div className="rounded-xl bg-surface-container px-3 py-2.5">
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
      <Field hint={t("sms_gateway_url_hint")} label={t("sms_gateway_url")}>
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
          type="password"
          value={form.gatewayPassword}
        />
      </Field>
      {inboundUrl && (
        <Field hint={t("sms_inbound_url_hint")} label={t("sms_inbound_url")}>
          <Input readOnly value={inboundUrl} />
        </Field>
      )}
    </>
  );
}

/** Secção "custom" — API HTTP arbitrária configurada pela loja (free). */
function SmsCustomFields({
  form,
  hasCustomHeaders,
  setForm,
  t,
}: {
  form: SmsFormState;
  hasCustomHeaders: boolean;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
  t: (key: string) => string;
}) {
  return (
    <>
      <p className="rounded-xl bg-surface-container px-3 py-2.5 text-on-surface-variant text-xs">
        {t("sms_custom_hint")}
      </p>
      <Field hint={t("sms_custom_url_hint")} label={t("sms_custom_url")}>
        <Input
          onChange={(e) =>
            setForm((f) => ({ ...f, customUrl: e.target.value }))
          }
          placeholder="https://api.provider.com/sms/send"
          type="url"
          value={form.customUrl}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("sms_custom_method")}>
          <Select
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                customMethod: e.target.value as "GET" | "POST",
              }))
            }
            value={form.customMethod}
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </Select>
        </Field>
        <Field
          hint={t("sms_custom_format_hint")}
          label={t("sms_custom_format")}
        >
          <Select
            disabled={form.customMethod === "GET"}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                customBodyFormat: e.target.value as "form" | "json",
              }))
            }
            value={form.customMethod === "GET" ? "form" : form.customBodyFormat}
          >
            <option value="json">JSON</option>
            <option value="form">form-urlencoded</option>
          </Select>
        </Field>
      </div>
      <Field
        hint={t("sms_custom_headers_hint")}
        label={t("sms_custom_headers")}
      >
        <textarea
          autoComplete="off"
          className="min-h-16 w-full rounded-xl bg-surface-container px-4 py-2.5 font-mono text-on-surface text-xs focus:bg-surface-container-lowest"
          onChange={(e) =>
            setForm((f) => ({ ...f, customHeaders: e.target.value }))
          }
          placeholder={
            hasCustomHeaders
              ? t("sms_custom_headers_saved")
              : '{"Authorization": "Bearer TOKEN"}'
          }
          value={form.customHeaders}
        />
      </Field>
      <Field
        hint={t("sms_custom_template_hint")}
        label={t("sms_custom_template")}
      >
        <textarea
          autoComplete="off"
          className="min-h-16 w-full rounded-xl bg-surface-container px-4 py-2.5 font-mono text-on-surface text-xs focus:bg-surface-container-lowest"
          onChange={(e) =>
            setForm((f) => ({ ...f, customBodyTemplate: e.target.value }))
          }
          placeholder='{"to": "{{to}}", "message": "{{text}}"}'
          value={form.customBodyTemplate}
        />
      </Field>
      <Field
        hint={t("sms_custom_success_hint")}
        label={t("sms_custom_success")}
      >
        <Input
          autoComplete="off"
          onChange={(e) =>
            setForm((f) => ({ ...f, customSuccessText: e.target.value }))
          }
          placeholder='"sent"'
          value={form.customSuccessText}
        />
      </Field>
    </>
  );
}

/** Secção "cloud" — BulkSMS relay via OficinaOS Cloud (Pro module sms). */
function SmsCloudFields({
  form,
  moduleEnabled,
  setForm,
  settings,
  t,
}: {
  form: SmsFormState;
  moduleEnabled: boolean;
  setForm: React.Dispatch<React.SetStateAction<SmsFormState>>;
  settings: Store["smsSettings"];
  t: (key: string) => string;
}) {
  if (!moduleEnabled) {
    return (
      <p className="rounded-xl bg-surface-container px-3 py-2.5 text-on-surface-variant text-xs">
        {t("sms_cloud_upsell")}
      </p>
    );
  }
  return (
    <>
      <p className="rounded-xl bg-surface-container px-3 py-2.5 text-on-surface-variant text-xs">
        {t("sms_cloud_hint")}
      </p>
      <Field hint={t("sms_bulksms_id_hint")} label={t("sms_bulksms_id")}>
        <Input
          autoComplete="off"
          onChange={(e) =>
            setForm((f) => ({ ...f, bulksmsTokenId: e.target.value }))
          }
          value={form.bulksmsTokenId}
        />
      </Field>
      <Field
        hint={t("sms_bulksms_secret_hint")}
        label={t("sms_bulksms_secret")}
      >
        <Input
          autoComplete="new-password"
          onChange={(e) =>
            setForm((f) => ({ ...f, bulksmsTokenSecret: e.target.value }))
          }
          placeholder={settings?.hasBulksmsSecret ? "••••••••" : ""}
          type="password"
          value={form.bulksmsTokenSecret}
        />
      </Field>
      <Field hint={t("sms_cloud_sender_hint")} label={t("sms_cloud_sender")}>
        <Input
          autoComplete="off"
          maxLength={11}
          onChange={(e) =>
            setForm((f) => ({ ...f, cloudSender: e.target.value }))
          }
          placeholder="OFICINA"
          value={form.cloudSender}
        />
      </Field>
      {settings?.credentialsAtCloud && (
        <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
          {t("sms_cloud_credentials_active")}
        </p>
      )}
      {settings?.cloudWebhookUrl && (
        <div className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
          <p className="mb-1">{t("sms_cloud_webhook_hint")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-surface px-2 py-1 text-[11px]">
              {settings.cloudWebhookUrl}
            </code>
            <Button
              onClick={async () => {
                await copyTextToClipboard(settings.cloudWebhookUrl ?? "");
              }}
              type="button"
              variant="ghost"
            >
              {t("copy")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
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
  const [form, setForm] = useState<SmsFormState>({
    bulksmsTokenId: "",
    bulksmsTokenSecret: "",
    cloudSender: "",
    customBodyFormat: "json",
    customBodyTemplate: "",
    customHeaders: "",
    customMethod: "POST",
    customSuccessText: "",
    customUrl: "",
    enabled: false,
    gatewayPassword: "",
    gatewayUrl: "",
    gatewayUser: "",
    transport: "android",
  });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (smsSettings && !loaded) {
      setForm((f) => ({
        ...f,
        bulksmsTokenId: smsSettings.bulksmsTokenId ?? "",
        cloudSender: smsSettings.cloudSender ?? "",
        customBodyFormat: smsSettings.customBodyFormat ?? "json",
        customBodyTemplate: smsSettings.customBodyTemplate ?? "",
        customMethod: smsSettings.customMethod ?? "POST",
        customSuccessText: smsSettings.customSuccessText ?? "",
        customUrl: smsSettings.customUrl ?? "",
        enabled: smsSettings.enabled,
        gatewayUrl: smsSettings.gatewayUrl ?? "",
        gatewayUser: smsSettings.gatewayUser ?? "",
        transport: smsSettings.transport ?? "android",
      }));
      setLoaded(true);
    }
  }, [smsSettings, loaded]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const { webhookRegistered } = await onSave({
        enabled: form.enabled,
        transport: form.transport,
        bulksmsTokenId: form.bulksmsTokenId,
        bulksmsTokenSecret: form.bulksmsTokenSecret || undefined,
        cloudSender: form.cloudSender,
        customBodyFormat: form.customBodyFormat,
        customBodyTemplate: form.customBodyTemplate,
        customHeaders: form.customHeaders || undefined,
        customMethod: form.customMethod,
        customSuccessText: form.customSuccessText,
        customUrl: form.customUrl,
        gatewayPassword: form.gatewayPassword || undefined,
        gatewayUrl: form.gatewayUrl,
        gatewayUser: form.gatewayUser,
      });
      if (form.enabled && form.transport === "android" && !webhookRegistered) {
        toast.warning(t("sms_webhook_not_registered"));
      }
      setForm((f) => ({
        ...f,
        bulksmsTokenSecret: "",
        customHeaders: "",
        gatewayPassword: "",
      }));
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
  // Os transportes locais (android/custom) são free — o módulo "sms"
  // gateia apenas a secção cloud, enforçado no relay (não nesta UI).
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

        {form.enabled && (
          <div className="mt-5 space-y-4">
            <Field label={t("sms_transport")}>
              <Select
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    transport: e.target.value as SmsFormState["transport"],
                  }))
                }
                value={form.transport}
              >
                <option value="android">{t("sms_transport_android")}</option>
                <option value="custom">{t("sms_transport_custom")}</option>
                <option value="cloud">{t("sms_transport_cloud")}</option>
              </Select>
            </Field>

            {form.transport === "android" && (
              <SmsAndroidFields
                form={form}
                inboundUrl={inboundUrl}
                setForm={setForm}
                t={t}
              />
            )}
            {form.transport === "custom" && (
              <SmsCustomFields
                form={form}
                hasCustomHeaders={smsSettings?.hasCustomHeaders ?? false}
                setForm={setForm}
                t={t}
              />
            )}
            {form.transport === "cloud" && (
              <SmsCloudFields
                form={form}
                moduleEnabled={smsSettings?.moduleEnabled ?? false}
                setForm={setForm}
                settings={smsSettings}
                t={t}
              />
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
              {form.transport === "android" && (
                <Button
                  className="flex min-h-11"
                  onClick={handleRegister}
                  size="sm"
                  variant="secondary"
                >
                  {t("sms_register_webhook")}
                </Button>
              )}
            </div>
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
    </>
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
  remarketingCooldownDays: string;
  remarketingDays: string;
  remarketingEnabled: boolean;
  remarketingTemplate: string;
  trackingBaseUrl: string;
  transport: "meta" | "evolution";
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
    </div>
  );
}
