import {
  isWhatsAppLocalDeprecationExpired,
  whatsappLocalDeprecationDaysLeft,
} from "@shared/constants/whatsapp-migration";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useSettingsStore,
  type WhatsAppMigrationEvent,
} from "@/stores/settings";
import { EvolutionSection } from "./evolution-section";

type Store = ReturnType<typeof useSettingsStore.getState>;

interface ChannelSettingsProps {
  onFetchWhatsAppSettings: () => Promise<void>;
  onSaveSmsSettings: (data: {
    enabled?: boolean;
    gatewayPassword?: string;
    gatewayUrl?: string;
    gatewayUser?: string;
  }) => Promise<void>;
  onSaveWhatsAppSettings: (data: {
    apiToken?: string;
    cloudConsent?: boolean;
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

function phoneRotationNeedsReplacementToken(
  form: WhatsAppFormState,
  settings: Store["whatsAppSettings"]
): boolean {
  return Boolean(
    settings?.credentialsAtCloud &&
      !settings.hasApiToken &&
      form.phoneNumberId !== "" &&
      form.phoneNumberId !== (settings.phoneNumberId ?? "") &&
      !form.apiToken
  );
}

function cloudAuthorizationRequiredAfterSunset(
  settings: Store["whatsAppSettings"],
  transport: "meta" | "evolution"
): boolean {
  return Boolean(
    transport === "meta" &&
      isWhatsAppLocalDeprecationExpired(settings?.localDeprecationStartedAt) &&
      !settings?.cloudConsentAccepted &&
      (settings?.phoneNumberId ||
        settings?.credentialsAtCloud ||
        settings?.hasApiToken)
  );
}

function buildWhatsAppSavePayload(
  form: WhatsAppFormState,
  remarketingModule: boolean | undefined
) {
  return {
    apiToken: form.apiToken || undefined,
    ...cloudConsentPayload(form),
    businessId: form.businessId || undefined,
    phoneNumberId: form.phoneNumberId || undefined,
    enabled: form.enabled,
    trackingBaseUrl: form.trackingBaseUrl,
    pickupReminderTemplate: form.pickupReminderTemplate,
    ...(remarketingModule
      ? {
          remarketingEnabled: form.remarketingEnabled,
          remarketingDays: Number.parseInt(form.remarketingDays, 10) || 90,
          remarketingCooldownDays:
            Number.parseInt(form.remarketingCooldownDays, 10) || 180,
          remarketingTemplate: form.remarketingTemplate,
        }
      : {}),
    transport: form.transport,
    ...(form.transport === "evolution"
      ? {
          evolutionUrl: form.evolutionUrl,
          evolutionInstance: form.evolutionInstance,
          evolutionApiKey: form.evolutionApiKey || undefined,
          disclaimerAccepted: form.disclaimerAccepted,
          ...(form.botDisclaimerAccepted
            ? { botDisclaimerAccepted: true }
            : {}),
          botDailyCap: Number.parseInt(form.botDailyCap, 10) || undefined,
        }
      : {}),
  };
}

function SmsCard({
  smsSettings,
  onSave,
  onSendTest,
}: {
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

  const locked = !smsSettings?.moduleEnabled;

  const handleSave = useCallback(async () => {
    if (locked) {
      toast.info(t("pro_only_upsell"));
      return;
    }
    setSaving(true);
    try {
      await onSave({
        enabled: form.enabled,
        gatewayPassword: form.gatewayPassword || undefined,
        gatewayUrl: form.gatewayUrl,
        gatewayUser: form.gatewayUser,
      });
      setForm((f) => ({ ...f, gatewayPassword: "" }));
    } catch {
      // Error is stored in Zustand state
    } finally {
      setSaving(false);
    }
  }, [form, locked, onSave, t]);

  const handleTest = useCallback(async () => {
    if (locked) {
      toast.info(t("pro_only_upsell"));
      return;
    }
    const res = await onSendTest();
    if (res.ok) {
      toast.success(t("sms_test_sent"));
    } else if (res.message) {
      toast.error(res.message);
    }
  }, [locked, onSendTest, t]);

  // Todo o SMS é Pro (decisão 2026-11-23): o card fica visível mas
  // locked — o switch, a gravação e o teste só informam que a opção
  // existe no Pro em vez de agir.
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
            onChange={(checked) => {
              if (checked && locked) {
                toast.info(t("pro_only_upsell"));
                return;
              }
              setForm((f) => ({ ...f, enabled: checked }));
            }}
          />
          <span
            className="font-medium text-on-surface text-sm"
            id="sms-enabled-label"
          >
            {t("sms_enabled")}
          </span>
        </div>
        <p className="mt-2 text-on-surface-variant text-xs">{t("sms_desc")}</p>
        {locked && (
          <p className="mt-2 rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
            {t("pro_only_upsell")}
          </p>
        )}

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
          <p className="mt-2 text-on-surface-variant text-xs">
            {t("sms_sim_terms")}
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

/**
 * Revogação explícita da cópia Cloud das credenciais Meta. Fica fora dos
 * campos Meta e do gate Pro de propósito: mesmo com o transporte desligado,
 * em Evolution ou sem entitlement fresco, a loja tem de conseguir retirar a
 * cópia que já está na Cloud. A confirmação em dois passos evita o clique
 * acidental sem abrir um modal que bloqueie o resto das definições.
 */
function CloudCredentialsRevokeBlock() {
  const { t } = useTranslation();
  const revokeWhatsAppCloudCredentials = useSettingsStore(
    (s) => s.revokeWhatsAppCloudCredentials
  );
  const [confirming, setConfirming] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = useCallback(async () => {
    setRevoking(true);
    try {
      await revokeWhatsAppCloudCredentials();
      toast.success(t("whatsapp_revoke_cloud_success"));
      setConfirming(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("whatsapp_cloud_action_failed")
      );
    } finally {
      setRevoking(false);
    }
  }, [revokeWhatsAppCloudCredentials, t]);

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
      <p className="text-on-surface text-xs leading-relaxed">
        {t("whatsapp_cloud_credentials_stored")}
      </p>
      {confirming ? (
        <div className="mt-3">
          <p className="font-medium text-on-surface text-xs leading-relaxed">
            {t("whatsapp_revoke_cloud_confirm_help")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              loading={revoking}
              onClick={handleRevoke}
              size="sm"
              variant="destructive"
            >
              {t("whatsapp_revoke_cloud_button")}
            </Button>
            <Button
              disabled={revoking}
              onClick={() => setConfirming(false)}
              size="sm"
              variant="secondary"
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="mt-3"
          onClick={() => setConfirming(true)}
          size="sm"
          variant="destructive-soft"
        >
          {t("whatsapp_revoke_cloud_button")}
        </Button>
      )}
    </div>
  );
}

const MIGRATION_EVENT_TYPE_KEYS: Record<
  WhatsAppMigrationEvent["type"],
  string
> = {
  LOCAL_FALLBACK: "whatsapp_migration_event_local_fallback",
  LOCAL_TOKEN_PURGED: "whatsapp_migration_event_token_purged",
};

const MIGRATION_EVENT_REASON_KEYS: Record<string, string> = {
  cloud_http_5xx: "whatsapp_migration_reason_cloud_5xx",
  cloud_network_error: "whatsapp_migration_reason_cloud_network",
  transition_deadline_reached: "whatsapp_migration_reason_deadline",
};

function CloudAuthorizationRequiredWarning({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  if (!visible) {
    return null;
  }
  return (
    <div
      className="mt-4 flex items-start gap-3 rounded-xl border border-error/40 bg-error/5 p-4"
      role="alert"
    >
      <span className="material-symbols-outlined text-error text-xl">
        error
      </span>
      <p className="text-on-surface text-sm leading-relaxed">
        {t("whatsapp_cloud_authorization_required")}
      </p>
    </div>
  );
}

/** Histórico visível da transição Cloud — sem segredos nem conteúdo de mensagens. */
function WhatsAppMigrationEventsBlock({
  events,
}: {
  events: WhatsAppMigrationEvent[];
}) {
  const { t } = useTranslation();
  if (events.length === 0) {
    return null;
  }
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container p-4">
      <p className="font-medium text-on-surface text-sm">
        {t("whatsapp_migration_events_title")}
      </p>
      <p className="mt-1 text-on-surface-variant text-xs leading-relaxed">
        {t("whatsapp_migration_events_help")}
      </p>
      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li
            className="rounded-lg bg-surface-container-low px-3 py-2"
            key={event.id}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-on-surface text-xs">
                {t(MIGRATION_EVENT_TYPE_KEYS[event.type])}
              </span>
              <time
                className="text-on-surface-variant text-xs"
                dateTime={event.createdAt}
              >
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </div>
            <p className="mt-1 text-on-surface-variant text-xs">
              {t(
                MIGRATION_EVENT_REASON_KEYS[event.reason] ??
                  "whatsapp_migration_reason_unknown"
              )}
            </p>
          </li>
        ))}
      </ul>
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
  const cloudConsentStored = Boolean(settings?.cloudConsentAccepted);
  const migrationExpired = isWhatsAppLocalDeprecationExpired(
    settings?.localDeprecationStartedAt
  );
  const showCloudConsent =
    !cloudConsentStored &&
    (!settings?.credentialsAtCloud || form.apiToken !== "" || migrationExpired);
  const legacyTokenMigration = Boolean(
    settings?.hasApiToken &&
      !settings?.credentialsAtCloud &&
      !cloudConsentStored
  );
  const migrationDaysLeft = whatsappLocalDeprecationDaysLeft(
    settings?.localDeprecationStartedAt
  );
  const phoneRotationNeedsToken = Boolean(
    settings?.credentialsAtCloud && !settings.hasApiToken
  );
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
        {phoneRotationNeedsToken && (
          <p className="mt-1.5 text-on-surface-variant text-xs">
            {t("whatsapp_phone_rotation_token_help")}
          </p>
        )}
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
      {showCloudConsent && (
        <div
          className={
            legacyTokenMigration
              ? "rounded-xl border border-warning/40 bg-warning/5 p-4"
              : "rounded-xl bg-surface-container p-4"
          }
        >
          <p className="text-on-surface text-xs leading-relaxed">
            {t(
              legacyTokenMigration
                ? "whatsapp_cloud_migration_warning"
                : "whatsapp_cloud_consent_help"
            )}
            {legacyTokenMigration &&
              ` ${t("whatsapp_cloud_migration_days_left", {
                count: migrationDaysLeft,
              })}`}
          </p>
          <div className="mt-3 flex items-center gap-1">
            <Checkbox
              checked={form.cloudConsent}
              id="wa-cloud-consent"
              onChange={(e) =>
                setForm((f) => ({ ...f, cloudConsent: e.target.checked }))
              }
            />
            <Label
              className="cursor-pointer select-none font-medium text-sm"
              htmlFor="wa-cloud-consent"
            >
              {t("whatsapp_cloud_consent_accept")}
            </Label>
          </div>
        </div>
      )}
      {!settings?.credentialsAtCloud &&
        settings?.hasApiToken &&
        cloudConsentStored && (
          <p className="rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
            {t("whatsapp_relay_pending")}
          </p>
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
      <WaTemplatesBlock
        isCloud={Boolean(settings?.credentialsAtCloud)}
        locked={!settings?.whatsappModule}
      />
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

// Razões geradas pela app/Cloud chegam como códigos estáveis → chave
// i18n. Razões da Meta (rejected_reason, erros 132xxx) vêm verbatim e
// mostram-se cruas — não há tradução para diagnósticos da Meta.
const WA_TPL_REASON_KEYS: Record<string, string> = {
  GRAPH_UNREACHABLE: "wa_tpl_reason_graph_unreachable",
  INVALID_BODY_EDGES: "wa_tpl_reason_invalid_body_edges",
  INVALID_NAME: "wa_tpl_reason_invalid_name",
};

function waTplDesc(
  isCloud: boolean,
  locked: boolean,
  t: (key: string) => string
): string {
  if (locked) {
    return t("pro_only_upsell");
  }
  return isCloud ? t("wa_tpl_desc") : t("wa_tpl_free_desc");
}

/**
 * Templates Meta (§5.6). Pro/cloud: um chip por template com o estado
 * que a Cloud devolveu e o botão "Voltar a submeter" que corre o sync.
 * Sem o módulo "whatsapp-bot" (decisão 2026-11-23 — grátis não envia
 * nada) o bloco fica locked: a lista de cópia manual deixou de fazer
 * sentido e mostra-se só o aviso Pro.
 */
function WaTemplatesBlock({
  isCloud,
  locked,
}: {
  isCloud: boolean;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const waTemplates = useSettingsStore((s) => s.waTemplates);
  const fetchWaTemplates = useSettingsStore((s) => s.fetchWaTemplates);
  const syncWaTemplates = useSettingsStore((s) => s.syncWaTemplates);
  const [syncing, setSyncing] = useState(false);

  const tplReasonTitle = (reason: string | null | undefined) => {
    if (!reason) {
      return;
    }
    const key = WA_TPL_REASON_KEYS[reason];
    return key ? t(key) : reason;
  };

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
        {isCloud && !locked && (
          <Button loading={syncing} onClick={handleResync} size="sm">
            {t("wa_tpl_resubmit")}
          </Button>
        )}
      </div>
      <p className="mt-1 text-on-surface-variant text-xs">
        {waTplDesc(isCloud, locked, t)}
      </p>
      {!locked && waTemplates.length > 0 && (
        <ul className="mt-3 space-y-3">
          {waTemplates.map((tpl) =>
            isCloud ? (
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
                  title={tplReasonTitle(tpl.reason)}
                >
                  {t(WA_TPL_STATUS_KEYS[tpl.status] ?? "wa_tpl_status_pending")}
                </span>
              </li>
            ) : (
              <li className="text-xs" key={tpl.name}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-on-surface">
                    {tpl.name}
                  </span>
                  <span className="shrink-0 text-on-surface-variant">
                    {tpl.category ?? "UTILITY"} · {tpl.language ?? "pt_PT"}
                  </span>
                </div>
                {tpl.body && (
                  <p className="mt-0.5 whitespace-pre-wrap font-mono text-on-surface-variant">
                    {tpl.body}
                  </p>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

interface WhatsAppFormState {
  apiToken: string;
  botDailyCap: string;
  botDisclaimerAccepted: boolean;
  businessId: string;
  cloudConsent: boolean;
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

function cloudConsentPayload(form: WhatsAppFormState) {
  return form.transport === "meta" && form.cloudConsent
    ? { cloudConsent: true }
    : {};
}

/**
 * "O que o bot pode dizer" — ficha da loja para o bot de IA (Pro).
 * Feeds POST /ai/bot-reply's shopCard; kept in shop settings (not the
 * WhatsApp settings object) because all channels share it.
 * Sem qualquer módulo que use o bot (sms / whatsapp-bot / ai-inbox) o
 * card fica visível mas locked — o switch e a gravação só informam que
 * a opção existe no Pro.
 */
function BotCard() {
  const { t } = useTranslation();
  const shopSettings = useSettingsStore((s) => s.shopSettings);
  const saveShopSettings = useSettingsStore((s) => s.saveShopSettings);
  const whatsAppSettings = useSettingsStore((s) => s.whatsAppSettings);
  const smsSettings = useSettingsStore((s) => s.smsSettings);
  const smsCloudDevice = useSettingsStore((s) => s.smsCloudDevice);
  const anyBotModule =
    Boolean(whatsAppSettings?.whatsappModule) ||
    Boolean(smsSettings?.moduleEnabled) ||
    Boolean(smsCloudDevice?.entitled);
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

  const locked = !anyBotModule;

  const handleSave = useCallback(async () => {
    if (locked) {
      toast.info(t("pro_only_upsell"));
      return;
    }
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
  }, [form, locked, saveShopSettings, t]);

  return (
    <div className="mt-4 rounded-2xl bg-surface-container-low p-5">
      <div className="flex select-none items-center gap-3">
        <Switch
          ariaLabel={t("bot_ai_enabled")}
          checked={form.enabled}
          onChange={(enabled) => {
            if (enabled && locked) {
              toast.info(t("pro_only_upsell"));
              return;
            }
            setForm((f) => ({ ...f, enabled }));
          }}
        />
        <span className="font-medium text-on-surface text-sm">
          {t("bot_ai_enabled")}
        </span>
      </div>
      <p className="mt-1 text-on-surface-variant text-xs">
        {t("bot_ai_enabled_help")}
      </p>
      {locked && (
        <p className="mt-2 rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
          {t("pro_only_upsell")}
        </p>
      )}

      {!locked && (
        <div className="mt-4 space-y-4">
          <Field
            hint={t("bot_info_text_help")}
            label={t("bot_info_text_label")}
          >
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
      )}
    </div>
  );
}

export default function ChannelSettings({
  smsSettings,
  whatsAppSettings,
  onFetchWhatsAppSettings,
  onSaveSmsSettings,
  onSaveWhatsAppSettings,
  onSendSmsTest,
}: ChannelSettingsProps) {
  const { t } = useTranslation();
  const [whatsAppForm, setWhatsAppForm] = useState<WhatsAppFormState>({
    apiToken: "",
    businessId: "",
    cloudConsent: false,
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
    botDisclaimerAccepted: false,
    botDailyCap: "200",
  });
  const [whatsAppSaving, setWhatsAppSaving] = useState(false);
  const [whatsAppLoaded, setWhatsAppLoaded] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // Decisão 2026-11-23: todo o WhatsApp é Pro — sem o módulo o card
  // fica visível mas locked; clicar nas ações informa que é Pro-only.
  const waLocked = !whatsAppSettings?.whatsappModule;
  const fetchWaTemplates = useSettingsStore((s) => s.fetchWaTemplates);

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
        cloudConsent: prev.cloudConsent,
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
        botDisclaimerAccepted: false,
        botDailyCap: String(whatsAppSettings.botDailyCap ?? 200),
      }));
    }
  }, [whatsAppSettings, whatsAppSaving]);

  const rotationNeedsToken = phoneRotationNeedsReplacementToken(
    whatsAppForm,
    whatsAppSettings
  );
  const migrationEvents = whatsAppSettings?.migrationEvents ?? [];
  const cloudAuthorizationRequired = cloudAuthorizationRequiredAfterSunset(
    whatsAppSettings,
    whatsAppForm.transport
  );

  const handleWhatsAppSave = useCallback(async () => {
    if (rotationNeedsToken) {
      toast.error(t("whatsapp_phone_rotation_token_required"));
      return;
    }
    if (waLocked && whatsAppForm.enabled) {
      toast.info(t("pro_only_upsell"));
      return;
    }
    setWhatsAppSaving(true);
    try {
      await onSaveWhatsAppSettings(
        buildWhatsAppSavePayload(
          whatsAppForm,
          whatsAppSettings?.remarketingModule
        )
      );
      // Segredos não voltam no GET. Limpar o input depois de gravar evita
      // reenviar o mesmo token em saves seguintes (o que repõe a flag Cloud
      // e desencadeia uploads duplicados).
      setWhatsAppForm((f) => ({ ...f, apiToken: "", cloudConsent: false }));
      // O trackingBaseUrl muda os blocos {{if}} dos corpos a submeter —
      // sem refetch a lista continuava a mostrar os specs antigos como
      // "prontos" enquanto o backend re-sincronizava em background. Um
      // segundo fetch apanha o resultado persistido desse sync.
      fetchWaTemplates().catch(() => null);
      setTimeout(() => {
        fetchWaTemplates().catch(() => null);
      }, 4000);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("errors.save_shop_settings")
      );
    } finally {
      setWhatsAppSaving(false);
    }
  }, [
    whatsAppForm,
    onSaveWhatsAppSettings,
    whatsAppSettings?.remarketingModule,
    rotationNeedsToken,
    waLocked,
    fetchWaTemplates,
    t,
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
            onChange={(e) => {
              if (e.target.checked && waLocked) {
                toast.info(t("pro_only_upsell"));
                return;
              }
              setWhatsAppForm((f) => ({ ...f, enabled: e.target.checked }));
            }}
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
        {waLocked && (
          <p className="mt-2 rounded-xl bg-surface-container px-3 py-2 text-on-surface-variant text-xs">
            {t("pro_only_upsell")}
          </p>
        )}

        {whatsAppSettings?.credentialsAtCloud && (
          <div className="mt-4">
            <CloudCredentialsRevokeBlock />
          </div>
        )}

        <CloudAuthorizationRequiredWarning
          visible={cloudAuthorizationRequired}
        />

        {migrationEvents.length > 0 && (
          <div className="mt-4">
            <WhatsAppMigrationEventsBlock events={migrationEvents} />
          </div>
        )}

        {whatsAppSettings?.phoneNumberId &&
          !whatsAppSettings.credentialsAtCloud &&
          !whatsAppSettings.hasApiToken && (
            <div
              className="mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4"
              role="status"
            >
              <span className="material-symbols-outlined text-warning text-xl">
                warning
              </span>
              <p className="text-on-surface text-sm leading-relaxed">
                {t("whatsapp_official_disconnected")}
              </p>
            </div>
          )}

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
                botDisclaimerStored={
                  whatsAppSettings?.botDisclaimerAccepted ?? false
                }
                botSuspended={Boolean(whatsAppSettings?.botSuspendedAt)}
                disclaimerStored={whatsAppSettings?.disclaimerAccepted ?? false}
                form={whatsAppForm}
                hasApiKey={whatsAppSettings?.hasEvolutionApiKey ?? false}
                onChange={(patch) =>
                  setWhatsAppForm((f) => ({ ...f, ...patch }))
                }
                savedInstance={whatsAppSettings?.evolutionInstance ?? null}
                savedUrl={whatsAppSettings?.evolutionUrl ?? null}
                whatsappModule={whatsAppSettings?.whatsappModule ?? false}
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
        onSave={onSaveSmsSettings}
        onSendTest={onSendSmsTest}
        smsSettings={smsSettings}
      />
      <BotCard />
    </div>
  );
}
