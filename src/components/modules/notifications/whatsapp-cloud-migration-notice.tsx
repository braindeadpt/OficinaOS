import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useCan } from "@/hooks/use-can";
import { useSettingsStore } from "@/stores/settings";

/**
 * Aviso retrospetivo único às lojas migradas para a Cloud antes do
 * consentimento explícito existir. É um banner global dismissível — informa
 * sem bloquear a app; o servidor é quem garante que a marcação é escrita uma
 * única vez mesmo que dois separadores confirmem em simultâneo.
 */
export default function WhatsAppCloudMigrationNotice() {
  const { t } = useTranslation();
  const canViewSettings = useCan({ settings: ["view"] });
  const whatsAppSettings = useSettingsStore((s) => s.whatsAppSettings);
  const fetchWhatsAppSettings = useSettingsStore(
    (s) => s.fetchWhatsAppSettings
  );
  const dismissNotice = useSettingsStore(
    (s) => s.dismissWhatsAppCloudMigrationNotice
  );
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (canViewSettings) {
      fetchWhatsAppSettings().catch(() => {
        // Silencioso no arranque — a página de definições mostra o erro se o
        // utilizador abrir o canal; o aviso nunca pode bloquear a app.
      });
    }
  }, [canViewSettings, fetchWhatsAppSettings]);

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    try {
      await dismissNotice();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("whatsapp_cloud_action_failed")
      );
    } finally {
      setDismissing(false);
    }
  }, [dismissNotice, t]);

  if (!(canViewSettings && whatsAppSettings?.cloudMigrationNoticePending)) {
    return null;
  }

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3"
      role="alert"
    >
      <Icon className="mt-0.5 shrink-0 text-warning" name="warning" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-on-surface text-sm">
          {t("whatsapp_cloud_migration_notice_title")}
        </p>
        <p className="mt-1 text-on-surface-variant text-sm leading-relaxed">
          {t("whatsapp_cloud_migration_notice_body")}
        </p>
      </div>
      <Button
        className="shrink-0"
        loading={dismissing}
        onClick={handleDismiss}
        size="sm"
        variant="secondary"
      >
        {t("whatsapp_cloud_migration_notice_dismiss")}
      </Button>
    </div>
  );
}
