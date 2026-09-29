import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAiChatStore } from "@/stores/ai-chat";
import type { ConversationItemData } from "./conversation-group";
import ConversationGroupList from "./conversation-group";
import ConversationItem from "./conversation-item";
import RenameDialog from "./rename-dialog";

interface FetchResult {
  items: ConversationItemData[];
  nextCursor: string | null;
}

async function fetchConversations(
  cursor?: string,
  search?: string
): Promise<FetchResult> {
  const params: Record<string, string | number> = { limit: 30 };
  if (cursor) {
    params.cursor = cursor;
  }
  if (search) {
    params.search = search;
  }
  const { data } = await api.get<FetchResult>("/ai", { params });
  return data;
}

function useConversations(_refreshKey: number) {
  const [conversations, setConversations] = useState<ConversationItemData[]>(
    []
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadInitial = useCallback(async (searchTerm?: string) => {
    setLoading(true);
    try {
      const result = await fetchConversations(undefined, searchTerm);
      setConversations(result.items);
      setCursor(result.nextCursor ?? null);
      setHasMore(!!result.nextCursor);
    } catch {
      toast.error("Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) {
      return;
    }
    setLoading(true);
    try {
      const result = await fetchConversations(cursor, search || undefined);
      setConversations((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor ?? null);
      setHasMore(!!result.nextCursor);
    } catch {
      toast.error("Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, search]);

  useEffect(() => {
    loadInitial(search || undefined);
  }, [search, loadInitial]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!(el && hasMore) || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadMore]);

  return {
    conversations,
    loading,
    search,
    sentinelRef,
    setSearch,
  };
}

function PanelHeader({
  collapsed,
  closeButtonRef,
  onCloseMobile,
  onNewConversation,
  search,
  onSearchChange,
}: {
  collapsed: boolean;
  closeButtonRef?: React.RefObject<HTMLButtonElement | null>;
  onCloseMobile: () => void;
  onNewConversation: () => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const { t } = useTranslation();

  if (collapsed) {
    return null;
  }

  return (
    <div className="shrink-0 space-y-3 border-outline-variant/50 border-b p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-on-surface text-sm">
          {t("ai_history_title")}
        </h3>
        <div className="flex items-center gap-1">
          <button
            aria-label={t("ai_history_new")}
            className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
            onClick={onNewConversation}
            type="button"
          >
            <span className="material-symbols-outlined text-xl">add</span>
          </button>
          <button
            aria-label={t("close")}
            className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest lg:hidden"
            onClick={onCloseMobile}
            ref={closeButtonRef}
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
      </div>
      <div className="relative">
        <span className="material-symbols-outlined absolute start-3 top-2.5 text-base text-on-surface-variant">
          search
        </span>
        <input
          className="w-full rounded-xl bg-surface-container-lowest py-2 ps-9 pe-3 text-sm placeholder:text-on-surface-variant/50"
          onChange={(e) => {
            onSearchChange(e.target.value);
          }}
          placeholder={t("ai_history_search")}
          type="text"
          value={search}
        />
      </div>
    </div>
  );
}

function CollapsedStrip({
  conversations,
  activeId,
  onExpand,
  onSelect,
}: {
  conversations: ConversationItemData[];
  activeId: string | null;
  onExpand: () => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center gap-2 border-outline-variant/50 border-e py-3">
      <button
        aria-label={t("ai_history_expand")}
        className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
        onClick={onExpand}
        type="button"
      >
        <span className="material-symbols-outlined text-xl">
          side_navigation
        </span>
      </button>
      <span className="mb-1 font-bold text-[10px] text-on-surface-variant uppercase tracking-widest [writing-mode:vertical-rl]">
        {t("ai_history_collapsed_label")}
      </span>
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {conversations.slice(0, 20).map((c) => (
          <button
            aria-label={c.title || t("ai_history_untitled")}
            className={`mx-auto h-8 w-8 shrink-0 rounded-full font-bold text-xs ${
              activeId === c.id
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface-variant"
            }`}
            key={c.id}
            onClick={() => {
              onSelect(c.id);
            }}
            type="button"
          >
            {(c.title || c.firstMessage || "?")[0].toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyPanel() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
      <span className="material-symbols-outlined text-4xl text-on-surface-variant">
        forum
      </span>
      <p className="font-bold text-on-surface-variant text-sm">
        {t("ai_history_empty")}
      </p>
      <p className="text-on-surface-variant text-xs">
        {t("ai_history_empty_desc")}
      </p>
    </div>
  );
}

function ResizeHandle({ onResize }: { onResize: (deltaX: number) => void }) {
  const { t } = useTranslation();
  const dragging = useRef(false);
  const lastX = useRef(0);

  return (
    <div
      aria-label={t("ai_history_resize")}
      aria-valuemax={480}
      aria-valuemin={220}
      aria-valuenow={220}
      className="absolute inset-y-0 start-0 z-10 hidden w-1.5 cursor-col-resize justify-center lg:flex"
      onBlur={() => {
        dragging.current = false;
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastX.current = e.clientX;

        const handleMove = (ev: MouseEvent) => {
          if (dragging.current) {
            const delta = lastX.current - ev.clientX;
            lastX.current = ev.clientX;
            onResize(delta);
          }
        };
        const handleUp = () => {
          dragging.current = false;
          document.removeEventListener("mousemove", handleMove);
          document.removeEventListener("mouseup", handleUp);
        };
        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleUp);
      }}
      role="slider"
      tabIndex={-1}
    >
      <div className="my-auto h-8 w-0.5 rounded-full bg-outline-variant/60 transition-colors group-hover:bg-primary/40" />
    </div>
  );
}

export default function ConversationHistoryPanel() {
  const { t } = useTranslation();
  const refreshKey = useAiChatStore((s) => s.refreshKey);
  const activeId = useAiChatStore((s) => s.activeConversationId);
  const panelOpen = useAiChatStore((s) => s.panelOpen);
  const mobileSheetOpen = useAiChatStore((s) => s.mobileSheetOpen);
  const collapsed = useAiChatStore((s) => s.panelCollapsed);
  const panelWidth = useAiChatStore((s) => s.panelWidth);
  const setActiveId = useAiChatStore((s) => s.setActiveConversationId);
  const setCollapsed = useAiChatStore((s) => s.setCollapsed);
  const setPanelWidth = useAiChatStore((s) => s.setPanelWidth);
  const togglePanel = useAiChatStore((s) => s.togglePanel);
  const setMobileSheetOpen = useAiChatStore((s) => s.setMobileSheetOpen);
  const createNewConversation = useAiChatStore((s) => s.createNewConversation);

  const mobileCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileSheetOpen) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileSheetOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    mobileCloseRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileSheetOpen, setMobileSheetOpen]);

  const { conversations, loading, search, sentinelRef, setSearch } =
    useConversations(refreshKey);

  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleSelect = useCallback(
    (id: string) => {
      setActiveId(id);
      setMobileSheetOpen(false);
    },
    [setActiveId, setMobileSheetOpen]
  );

  const handleNew = useCallback(() => {
    createNewConversation();
    setMobileSheetOpen(false);
  }, [createNewConversation, setMobileSheetOpen]);

  const handleToggleStar = useCallback(
    async (id: string, starred: boolean) => {
      try {
        await api.put(`/ai/${id}`, { starred });
      } catch {
        toast.error(t("ai_agent_stream_error"));
      }
    },
    [t]
  );

  const handleDelete = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      await api.delete(`/ai/${deleteTarget}`);
      if (activeId === deleteTarget) {
        setActiveId(null);
      }
    } catch {
      toast.error(t("ai_agent_stream_error"));
    }
    setDeleteTarget(null);
  }, [deleteTarget, activeId, setActiveId, t]);

  const handleRename = useCallback((id: string, _title: string) => {
    setRenameTarget({ id, title: _title });
  }, []);

  const handleRenamed = useCallback(
    async (newTitle: string) => {
      if (!renameTarget) {
        return;
      }
      try {
        await api.put(`/ai/${renameTarget.id}`, { title: newTitle });
      } catch {
        toast.error(t("ai_agent_stream_error"));
      }
      setRenameTarget(null);
    },
    [renameTarget, t]
  );

  const handleResize = useCallback(
    (deltaX: number) => {
      const isRtl = document.documentElement.dir === "rtl";
      const delta = isRtl ? -deltaX : deltaX;
      setPanelWidth(panelWidth + delta);
    },
    [panelWidth, setPanelWidth]
  );

  const renderItem = useMemo(
    () => (conv: ConversationItemData) => (
      <ConversationItem
        data={conv}
        isActive={conv.id === activeId}
        onDelete={handleDelete}
        onRename={handleRename}
        onSelect={handleSelect}
        onToggleStar={handleToggleStar}
      />
    ),
    [activeId, handleDelete, handleRename, handleSelect, handleToggleStar]
  );

  if (!(panelOpen || mobileSheetOpen)) {
    return null;
  }

  if (collapsed && !mobileSheetOpen) {
    return (
      <CollapsedStrip
        activeId={activeId}
        conversations={conversations}
        onExpand={() => {
          setCollapsed(false);
        }}
        onSelect={handleSelect}
      />
    );
  }

  return (
    <>
      {mobileSheetOpen && (
        <div className="fixed inset-0 z-50 bg-surface/70 p-3 backdrop-blur-sm lg:hidden">
          <aside
            aria-label={t("ai_history_title")}
            aria-modal="true"
            className="ms-auto flex h-full w-full max-w-sm flex-col rounded-3xl bg-surface-container-low shadow-2xl"
            role="dialog"
          >
            <PanelHeader
              closeButtonRef={mobileCloseRef}
              collapsed={false}
              onCloseMobile={() => {
                setMobileSheetOpen(false);
              }}
              onNewConversation={handleNew}
              onSearchChange={setSearch}
              search={search}
            />
            {conversations.length === 0 && !loading ? (
              <EmptyPanel />
            ) : (
              <div className="flex-1 overflow-y-auto p-2">
                <ConversationGroupList
                  conversations={conversations}
                  renderItem={renderItem}
                />
                {hasMoreSentinel(loading, conversations, sentinelRef)}
              </div>
            )}
          </aside>
        </div>
      )}

      <aside
        className="group relative hidden shrink-0 flex-col bg-surface-container-low lg:flex"
        style={{ width: `${panelWidth}px` }}
      >
        <ResizeHandle onResize={handleResize} />
        <PanelHeader
          collapsed={false}
          onCloseMobile={() => {
            togglePanel();
          }}
          onNewConversation={handleNew}
          onSearchChange={setSearch}
          search={search}
        />
        {conversations.length === 0 && !loading ? (
          <EmptyPanel />
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            <ConversationGroupList
              conversations={conversations}
              renderItem={renderItem}
            />
            {hasMoreSentinel(loading, conversations, sentinelRef)}
          </div>
        )}
        <div className="shrink-0 bg-surface-container p-2">
          <button
            aria-label={t("ai_history_collapse")}
            className="w-full rounded-lg p-2 text-on-surface-variant text-xs transition-colors hover:bg-surface-container-highest"
            onClick={() => {
              setCollapsed(true);
            }}
            type="button"
          >
            <span className="material-symbols-outlined me-1 align-middle text-sm">
              side_navigation
            </span>
            {t("ai_history_collapse")}
          </button>
        </div>
      </aside>

      <RenameDialog
        conversationId={renameTarget?.id || ""}
        currentTitle={renameTarget?.title || ""}
        onClose={() => {
          setRenameTarget(null);
        }}
        onRenamed={handleRenamed}
        open={!!renameTarget}
      />

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-surface-container-high p-6 shadow-xl">
            <h3 className="mb-2 font-bold text-lg text-on-surface">
              {t("ai_history_delete_title")}
            </h3>
            <p className="mb-5 text-on-surface-variant text-sm">
              {t("ai_history_delete_desc")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-xl px-4 py-2 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
                onClick={() => {
                  setDeleteTarget(null);
                }}
                type="button"
              >
                {t("ai_history_cancel")}
              </button>
              <button
                className="rounded-xl bg-error px-4 py-2 font-bold text-on-error text-sm transition-colors hover:opacity-90"
                onClick={() => {
                  confirmDelete();
                }}
                type="button"
              >
                {t("ai_history_delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function hasMoreSentinel(
  loading: boolean,
  _conversations: ConversationItemData[],
  sentinelRef: React.RefObject<HTMLDivElement | null>
) {
  return (
    <>
      {loading && (
        <div className="flex justify-center py-4">
          <span className="material-symbols-outlined animate-spin text-on-surface-variant">
            progress_activity
          </span>
        </div>
      )}
      <div className="h-1" ref={sentinelRef} />
    </>
  );
}
