import { useTranslation } from "react-i18next";
import type { InAppAlert } from "@/stores/alerts";

const TYPE_CONFIG: Record<string, { icon: string; labelKey: string }> = {
  job_created: {
    icon: "add_circle",
    labelKey: "noti_type_job_created",
  },
  job_overdue: {
    icon: "schedule",
    labelKey: "noti_type_job_overdue",
  },
  job_waiting_parts: {
    icon: "inventory_2",
    labelKey: "noti_type_job_waiting_parts",
  },
  job_in_repair: {
    icon: "build",
    labelKey: "noti_type_job_in_repair",
  },
  job_on_hold: {
    icon: "pause_circle",
    labelKey: "noti_type_job_on_hold",
  },
  job_done: {
    icon: "check_circle",
    labelKey: "noti_type_job_done",
  },
  job_delivered: {
    icon: "local_shipping",
    labelKey: "noti_type_job_delivered",
  },
  job_returned: {
    icon: "autorenew",
    labelKey: "noti_type_job_returned",
  },
  job_cancelled: {
    icon: "cancel",
    labelKey: "noti_type_job_cancelled",
  },
  warranty_return_created: {
    icon: "autorenew",
    labelKey: "noti_type_warranty_return",
  },
  part_low_stock: {
    icon: "inventory",
    labelKey: "noti_type_part_low_stock",
  },
};

function formatRelativeTime(
  dateStr: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const ts = new Date(dateStr).getTime();
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) {
    return t("noti_time_now");
  }
  if (diffMin < 60) {
    return t("noti_time_min", { count: diffMin });
  }
  if (diffHr < 24) {
    return t("noti_time_hr", { count: diffHr });
  }
  if (diffDay < 7) {
    return t("noti_time_day", { count: diffDay });
  }
  return new Date(dateStr).toLocaleDateString();
}

interface AlertItemRowProps {
  alert: InAppAlert;
  onDelete: (id: string) => void;
  onNavigate: (jobId: string) => void;
}

function AlertItemRow({ alert, onDelete, onNavigate }: AlertItemRowProps) {
  const { t } = useTranslation();
  const config = TYPE_CONFIG[alert.type] ?? {
    icon: "info",
    labelKey: "noti_type_generic",
  };
  const hasJob = Boolean(alert.job);
  const isUnread = !alert.readAt;
  const labelParts = [
    t(config.labelKey),
    alert.job?.jobCode,
    isUnread ? t("noti_sr_unread") : "",
    formatRelativeTime(alert.createdAt, t),
  ].filter(Boolean);

  const iconClass = isUnread
    ? "bg-primary/10 text-primary"
    : "bg-surface-container-high text-on-surface-variant";

  const titleClass = isUnread ? "text-on-surface" : "text-on-surface-variant";

  return (
    <div
      className={`group flex items-start gap-4 rounded-2xl px-4 py-4 text-start sm:px-5 ${
        isUnread
          ? "bg-surface-container-lowest hover:bg-surface-container-low"
          : "bg-surface-container-low hover:bg-surface-container-high/60"
      }`}
    >
      {hasJob ? (
        <button
          aria-label={labelParts.join(", ")}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
          onClick={() => onNavigate(alert.job?.id ?? "")}
          type="button"
        >
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClass}`}
          >
            <span className="material-symbols-outlined text-[22px]">
              {config.icon}
            </span>
          </div>
        </button>
      ) : (
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
        >
          <span className="material-symbols-outlined text-[22px]">
            {config.icon}
          </span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        {hasJob ? (
          <button
            className="min-h-6 rounded-md transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            onClick={() => onNavigate(alert.job?.id ?? "")}
            type="button"
          >
            <span className={`font-bold text-sm ${titleClass}`}>
              {t(config.labelKey)}
            </span>
          </button>
        ) : (
          <span className={`font-bold text-sm ${titleClass}`}>
            {t(config.labelKey)}
          </span>
        )}
        {alert.job && (
          <span className="font-mono text-on-surface-variant text-xs">
            {" "}
            {alert.job.jobCode}
          </span>
        )}
        {isUnread && <span className="sr-only"> {t("noti_sr_unread")}</span>}
        <p className={`mt-1 text-sm leading-relaxed ${titleClass}`}>
          {alert.message}
        </p>
        <p className="mt-1.5 text-on-surface-variant/70 text-xs">
          {formatRelativeTime(alert.createdAt, t)}
        </p>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {isUnread && (
          <span
            aria-hidden="true"
            className="mt-2 h-2.5 w-2.5 rounded-full bg-primary"
          />
        )}
        <button
          aria-label={t("noti_dismiss")}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant/50 transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-2 focus-visible:outline-error focus-visible:outline-offset-2 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          onClick={() => onDelete(alert.id)}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    </div>
  );
}

export { AlertItemRow, formatRelativeTime, TYPE_CONFIG };
