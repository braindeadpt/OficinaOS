import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettingsStore } from "@/stores/settings";

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const colors: Record<string, string> = {
    CANCELLED: "bg-surface-container-high text-on-surface-variant",
    FAILED: "bg-error/10 text-error",
    QUEUED: "bg-tertiary-fixed text-on-tertiary-fixed-variant",
    SENT: "bg-success/10 text-success",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold text-xs ${colors[status] ?? "bg-surface-container-high text-on-surface-variant"}`}
    >
      {status === "QUEUED" && t("status_queued")}
      {status === "SENT" && t("status_sent")}
      {status === "FAILED" && t("status_failed")}
      {status === "CANCELLED" && t("status_cancelled")}
      {!["QUEUED", "SENT", "FAILED", "CANCELLED"].includes(status) && status}
    </span>
  );
}

export default function OutboxLog() {
  const { t } = useTranslation();
  const { outboxLogs, fetchOutboxLogs, cancelOutboxEntry } = useSettingsStore();

  const handleCancel = useCallback(
    async (id: string) => {
      const result = await cancelOutboxEntry(id);
      if (result.success) {
        toast(t("notification_cancelled"), { duration: 5000 });
        await fetchOutboxLogs();
      }
    },
    [cancelOutboxEntry, fetchOutboxLogs, t]
  );

  return (
    <div>
      <h3 className="font-extrabold font-headline text-lg text-on-surface tracking-tight">
        {t("notification_outbox")}
      </h3>
      <div className="mt-4 rounded-2xl bg-surface-container-low p-3">
        {outboxLogs.length === 0 ? (
          <div className="py-12 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30">
              outbox
            </span>
            <p className="mt-3 font-medium text-on-surface-variant text-sm">
              {t("no_notifications_sent")}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {outboxLogs.map((log) => (
              <article
                className="rounded-2xl bg-surface-container-lowest p-4 transition-colors hover:bg-surface-container"
                key={log.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-on-surface text-sm">
                      {log.templateName}
                    </p>
                    <p className="mt-1 text-on-surface-variant text-xs">
                      {log.recipientPhone} / {log.channel}
                    </p>
                  </div>
                  <StatusBadge status={log.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-on-surface-variant text-xs">
                  <span>{new Date(log.createdAt).toLocaleString()}</span>
                  {log.error && <span className="text-error">{log.error}</span>}
                  {log.status === "QUEUED" && (
                    <button
                      aria-label={t("cancel")}
                      className="flex min-h-11 items-center gap-1 rounded-xl bg-error/10 px-4 font-medium text-error text-xs transition-colors hover:bg-error/20 focus-visible:outline-2 focus-visible:outline-error focus-visible:outline-offset-2"
                      onClick={() => handleCancel(log.id)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        cancel
                      </span>
                      {t("cancel")}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
