import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import AlertList from "@/components/modules/notifications/alert-list";
import ChannelSettings from "@/components/modules/notifications/channel-settings";
import OutboxLog from "@/components/modules/notifications/outbox-log";
import { useCan } from "@/hooks/use-can";
import { useAlertsStore } from "@/stores/alerts";
import { useSettingsStore } from "@/stores/settings";

type FilterType = "all" | "unread" | "read";
type NotificationMode = "alerts" | "outbox" | "setup";

export default function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const alerts = useAlertsStore((s) => s.alerts);
  const markRead = useAlertsStore((s) => s.markRead);
  const markAllRead = useAlertsStore((s) => s.markAllRead);
  const deleteAlert = useAlertsStore((s) => s.deleteAlert);
  const fetchAlerts = useAlertsStore((s) => s.fetchAlerts);
  const initialized = useAlertsStore((s) => s.initialized);
  const unreadCount = useAlertsStore((s) => s.unreadCount);
  const {
    smsSettings,
    whatsAppSettings,
    notificationTemplates,
    fetchSmsSettings,
    fetchWhatsAppSettings,
    fetchNotificationTemplates,
    registerSmsWebhook,
    saveSmsSettings,
    saveWhatsAppSettings,
    sendSmsTest,
    fetchOutboxLogs,
  } = useSettingsStore();
  const [outboxLoaded, setOutboxLoaded] = useState(false);
  const [mode, setMode] = useState<NotificationMode>("alerts");
  // Setup = WhatsApp channel settings (settings:view); delete/cancel/test =
  // notifications:manage. A technician with only notifications:read gets
  // the alerts inbox and nothing that 403s.
  const canViewSettings = useCan({ settings: ["view"] });
  const canManage = useCan({ notifications: ["manage"] });

  useEffect(() => {
    if (!initialized) {
      fetchAlerts();
    }
  }, [initialized, fetchAlerts]);

  useEffect(() => {
    if (!outboxLoaded) {
      if (canViewSettings) {
        fetchWhatsAppSettings().catch(() => {
          /* intentionally swallowed */
        });
        fetchSmsSettings().catch(() => {
          /* intentionally swallowed */
        });
      }
      fetchOutboxLogs().catch(() => {
        /* intentionally swallowed */
      });
      if (notificationTemplates.length === 0) {
        fetchNotificationTemplates().catch(() => {
          /* intentionally swallowed */
        });
      }
      setOutboxLoaded(true);
    }
  }, [
    outboxLoaded,
    canViewSettings,
    fetchSmsSettings,
    fetchWhatsAppSettings,
    fetchOutboxLogs,
    fetchNotificationTemplates,
    notificationTemplates.length,
  ]);

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
  }, [markAllRead]);

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await deleteAlert(id);
      if (ok) {
        toast(t("notification_deleted"));
      } else {
        toast.error(t("errors.generic"));
      }
    },
    [deleteAlert, t]
  );

  const handleNavigate = useCallback(
    (jobId: string) => {
      if (!jobId) {
        return;
      }
      const alert = alerts.find((a) => a.job?.id === jobId);
      if (alert && !alert.readAt) {
        markRead(alert.id);
      }
      navigate(`/jobs/${jobId}`);
    },
    [alerts, markRead, navigate]
  );

  const [filter, setFilter] = useState<FilterType>("all");

  return (
    <>
      <div className="mb-6">
        <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
          {t("notifications")}
        </h2>
        <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
          {t("noti_subtitle")}
        </p>
      </div>

      <div
        className={`mb-6 grid gap-3 ${canViewSettings ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {(
          [
            ["alerts", t("notifications"), unreadCount],
            ["outbox", t("notification_outbox"), null],
            ...(canViewSettings
              ? ([["setup", t("channels_settings"), null]] as const)
              : []),
          ] as const
        ).map(([key, label, count]) => (
          <button
            className={`min-h-16 rounded-2xl px-4 text-start transition-colors ${
              mode === key
                ? "bg-primary-fixed text-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
            }`}
            key={key}
            onClick={() => setMode(key)}
            type="button"
          >
            <span className="block font-bold text-sm">{label}</span>
            {count !== null && (
              <span className="mt-1 block text-xs">
                {t("noti_filter_unread")}: {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {mode === "alerts" && (
        <AlertList
          alerts={alerts}
          canDelete={canManage}
          filter={filter}
          onDelete={handleDelete}
          onFilterChange={setFilter}
          onMarkAllRead={handleMarkAllRead}
          onNavigate={handleNavigate}
          unreadCount={unreadCount}
        />
      )}

      {mode === "setup" && (
        <ChannelSettings
          onFetchWhatsAppSettings={fetchWhatsAppSettings}
          onRegisterSmsWebhook={registerSmsWebhook}
          onSaveSmsSettings={saveSmsSettings}
          onSaveWhatsAppSettings={saveWhatsAppSettings}
          onSendSmsTest={sendSmsTest}
          smsSettings={smsSettings}
          whatsAppSettings={whatsAppSettings}
        />
      )}

      {mode === "outbox" && <OutboxLog />}
    </>
  );
}
