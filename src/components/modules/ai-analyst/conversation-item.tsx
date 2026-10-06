import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConversationItemData } from "./conversation-group";

interface ConversationItemProps {
  data: ConversationItemData;
  isActive: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onSelect: (id: string) => void;
  onToggleStar: (id: string, starred: boolean) => void;
}

function getAgentColor(name: string | null): string {
  if (!name) {
    return "#9CA3AF";
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = Math.trunc(name.charCodeAt(i) + hash * 31 - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

function getRelativeTime(dateStr: string, t: (key: string) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) {
    return t("ai_history_just_now");
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function ConversationItem({
  data,
  isActive,
  onDelete,
  onRename,
  onSelect,
  onToggleStar,
}: ConversationItemProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const delta = e.changedTouches[0].clientX - touchStartX.current;
      if (Math.abs(delta) < 60) {
        return;
      }
      if (delta > 0) {
        onToggleStar(data.id, !data.starred);
      } else {
        onDelete(data.id);
      }
    },
    [data.id, data.starred, onDelete, onToggleStar]
  );

  const title = data.title || data.firstMessage || t("ai_history_untitled");
  const displayTitle = title.length > 50 ? `${title.slice(0, 50)}…` : title;

  return (
    <button
      className={`group relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors ${
        isActive
          ? "bg-primary/10 text-on-surface"
          : "text-on-surface-variant hover:bg-surface-container-high"
      }`}
      onClick={() => {
        onSelect(data.id);
      }}
      onTouchEnd={handleTouchEnd}
      onTouchStart={handleTouchStart}
      type="button"
    >
      {data.agentName && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: getAgentColor(data.agentName) }}
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{displayTitle}</p>
        <div className="flex items-center gap-2 text-on-surface-variant text-xs">
          <span>{getRelativeTime(data.updatedAt, t)}</span>
          <span>·</span>
          <span>
            {t("ai_history_message_count", { count: data.messageCount })}
          </span>
        </div>
      </div>

      {data.starred && (
        <span
          className="material-symbols-outlined shrink-0 text-base text-warning"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          star
        </span>
      )}

      <div className="relative" ref={menuRef}>
        <button
          aria-label={t("more_actions")}
          className="shrink-0 rounded-lg p-1 opacity-0 transition-opacity hover:bg-surface-container-highest focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          type="button"
        >
          <span className="material-symbols-outlined text-lg">more_vert</span>
        </button>

        {menuOpen && (
          <>
            <button
              aria-label="Close menu"
              className="fixed inset-0 z-10"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
              type="button"
            />
            <div className="absolute end-0 top-full z-20 mt-1 min-w-[140px] rounded-xl bg-surface-container-high py-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-container-highest"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(data.id, data.title || "");
                  setMenuOpen(false);
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-base">
                  edit
                </span>
                {t("ai_history_rename")}
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-container-highest"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleStar(data.id, !data.starred);
                  setMenuOpen(false);
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-base">
                  star
                </span>
                {data.starred ? t("ai_history_unstar") : t("ai_history_star")}
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-error text-sm transition-colors hover:bg-surface-container-highest"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(data.id);
                  setMenuOpen(false);
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-base">
                  delete
                </span>
                {t("ai_history_delete")}
              </button>
            </div>
          </>
        )}
      </div>
    </button>
  );
}
