import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { useSettingsStore } from "@/stores/settings";

interface ChannelSettingsProps {
  onFetchWhatsAppSettings: () => Promise<void>;
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
  }) => Promise<void>;
  whatsAppSettings: ReturnType<
    typeof useSettingsStore.getState
  >["whatsAppSettings"];
}

export default function ChannelSettings({
  whatsAppSettings,
  onFetchWhatsAppSettings,
  onSaveWhatsAppSettings,
}: ChannelSettingsProps) {
  const { t } = useTranslation();
  const [whatsAppForm, setWhatsAppForm] = useState({
    apiToken: "",
    businessId: "",
    phoneNumberId: "",
    trackingBaseUrl: "",
    enabled: false,
    remarketingEnabled: false,
    remarketingDays: "90",
    remarketingCooldownDays: "180",
    remarketingTemplate: "oficinaos_remarketing",
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
                  setWhatsAppForm((f) => ({
                    ...f,
                    businessId: e.target.value,
                  }))
                }
                type="text"
                value={whatsAppForm.businessId}
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
                  setWhatsAppForm((f) => ({
                    ...f,
                    phoneNumberId: e.target.value,
                  }))
                }
                type="text"
                value={whatsAppForm.phoneNumberId}
              />
            </div>
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
                onChange={(e) =>
                  setWhatsAppForm((f) => ({ ...f, apiToken: e.target.value }))
                }
                placeholder={whatsAppSettings?.hasApiToken ? "••••••••" : ""}
                type="password"
                value={whatsAppForm.apiToken}
              />
            </div>
            {whatsAppSettings?.remarketingModule ? (
              <div className="rounded-xl bg-surface-container p-4">
                <div className="flex items-center gap-3">
                  <Switch
                    ariaLabelledBy="remarketing-enabled-label"
                    checked={whatsAppForm.remarketingEnabled}
                    onChange={(checked) =>
                      setWhatsAppForm((f) => ({
                        ...f,
                        remarketingEnabled: checked,
                      }))
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

                {whatsAppForm.remarketingEnabled && (
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
                          setWhatsAppForm((f) => ({
                            ...f,
                            remarketingDays: e.target.value,
                          }))
                        }
                        type="number"
                        value={whatsAppForm.remarketingDays}
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
                          setWhatsAppForm((f) => ({
                            ...f,
                            remarketingCooldownDays: e.target.value,
                          }))
                        }
                        type="number"
                        value={whatsAppForm.remarketingCooldownDays}
                      />
                    </Field>
                    <Field
                      hint={t("remarketing_template_hint")}
                      label={t("remarketing_template")}
                    >
                      <Input
                        autoComplete="off"
                        onChange={(e) =>
                          setWhatsAppForm((f) => ({
                            ...f,
                            remarketingTemplate: e.target.value,
                          }))
                        }
                        placeholder="oficinaos_remarketing"
                        value={whatsAppForm.remarketingTemplate}
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

            <Button
              className="flex min-h-11"
              disabled={whatsAppSaving}
              loading={whatsAppSaving}
              onClick={handleWhatsAppSave}
              size="sm"
            >
              {whatsAppSaving ? t("settings_saving") : t("save_changes")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
