import { useTranslation } from "react-i18next";
import type { InAppAlert } from "@/stores/alerts";
import { AlertItemRow } from "./alert-item-row";

type FilterType = "all" | "unread" | "read";

const FILTER_KEYS: FilterType[] = ["all", "unread", "read"];

interface AlertListProps {
  alerts: InAppAlert[];
  canDelete?: boolean;
  filter: FilterType;
  onDelete: (id: string) => void;
  onFilterChange: (filter: FilterType) => void;
  onMarkAllRead: () => void;
  onNavigate: (jobId: string) => void;
  unreadCount: number;
}

export default function AlertList({
  alerts,
  canDelete = false,
  filter,
  onDelete,
  onMarkAllRead,
  onNavigate,
  onFilterChange,
  unreadCount,
}: AlertListProps) {
  const { t } = useTranslation();
  const tabRefs = {
    all: null as HTMLButtonElement | null,
    read: null as HTMLButtonElement | null,
    unread: null as HTMLButtonElement | null,
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filter === "unread") {
      return !a.readAt;
    }
    if (filter === "read") {
      return Boolean(a.readAt);
    }
    return true;
  });

  function handleTabKeyDown(e: React.KeyboardEvent) {
    const currentIndex = FILTER_KEYS.indexOf(filter);
    let nextIndex: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % FILTER_KEYS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + FILTER_KEYS.length) % FILTER_KEYS.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = FILTER_KEYS.length - 1;
    }
    if (nextIndex !== undefined) {
      e.preventDefault();
      const nextKey = FILTER_KEYS[nextIndex];
      tabRefs[nextKey]?.focus();
    }
  }

  const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
    { key: "all", label: t("noti_filter_all") },
    { key: "unread", label: t("noti_filter_unread") },
    { key: "read", label: t("noti_filter_read") },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        {unreadCount > 0 && (
          <button
            className="flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 font-semibold text-primary text-sm transition-colors hover:bg-primary/10"
            onClick={onMarkAllRead}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              done_all
            </span>
            {t("noti_mark_all_read")}
          </button>
        )}
      </div>

      <div
        aria-label={t("noti_filter_label")}
        className="flex items-center gap-2 overflow-x-auto pb-2"
        role="tablist"
      >
        {FILTER_OPTIONS.map((opt) => (
          <button
            aria-selected={filter === opt.key}
            className={`whitespace-nowrap rounded-full px-4 py-2 font-semibold text-sm transition-colors ${
              filter === opt.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high"
            }`}
            id={`noti-tab-${opt.key}`}
            key={opt.key}
            onClick={() => onFilterChange(opt.key)}
            onKeyDown={handleTabKeyDown}
            ref={(el) => {
              tabRefs[opt.key] = el;
            }}
            role="tab"
            tabIndex={filter === opt.key ? 0 : -1}
            type="button"
          >
            {opt.label}
            {opt.key === "unread" && unreadCount > 0 && (
              <span className="ms-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-on-primary font-bold text-[10px] text-primary">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`noti-tab-${filter}`}
        aria-live="polite"
        className="mt-4 space-y-3"
        role="tabpanel"
      >
        {filteredAlerts.length === 0 ? (
          <div className="rounded-2xl bg-surface-container-low py-16 text-center">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">
              {filter === "unread"
                ? "notifications_active"
                : "notifications_off"}
            </span>
            <p className="mt-4 font-semibold text-on-surface-variant">
              {filter === "unread" && t("noti_no_unread")}
              {filter === "read" && t("noti_no_read")}
              {filter === "all" && t("noti_no_alerts")}
            </p>
            <p className="mt-1 text-on-surface-variant/70 text-sm">
              {filter === "all"
                ? t("noti_empty_desc")
                : t("noti_filter_empty_desc")}
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <AlertItemRow
              alert={alert}
              key={alert.id}
              onDelete={canDelete ? onDelete : undefined}
              onNavigate={onNavigate}
            />
          ))
        )}
      </div>
    </div>
  );
}
