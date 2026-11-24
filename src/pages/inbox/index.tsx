import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/select";
import { useCan } from "@/hooks/use-can";
import api, { getErrorMessage } from "@/lib/api";
import { useAiInboxStore } from "@/stores/ai-inbox";
import { useAuthStore } from "@/stores/auth";

/** Caixa de entrada unificada (Pro "ai-inbox", §G) — WhatsApp oficial,
 *  Evolution e SMS numa lista só, com rascunhos de IA a aguardar
 *  aprovação humana antes de saírem. */

const POLL_MS = 15_000;
const CHANNEL_ICON: Record<string, string> = {
  evolution: "chat",
  sms: "sms",
  whatsapp: "chat",
};

interface Conversation {
  assignedTo: { id: string; name: string } | null;
  channel: string;
  customer: { id: string; name: string } | null;
  escalatedAt: string | null;
  id: string;
  lastInboundAt: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastOutboundAt: string | null;
  phone: string;
  status: string;
  unreadCount: number;
}

interface Message {
  body: string;
  createdBy: { id: string; name: string } | null;
  deliveryStatus: string;
  direction: "INBOUND" | "OUTBOUND" | string;
  handledBy: string | null;
  id: string;
  readAt: string | null;
  receivedAt: string;
}

interface Draft {
  conversation: {
    channel: string;
    customer: { name: string } | null;
    id: string;
    phone: string;
  };
  createdBy: { id: string; name: string } | null;
  id: string;
  text: string;
}

interface StaffUser {
  id: string;
  name: string;
}

type Filter = "atribuidas_a_mim" | "escaladas" | "nao_lidas" | "sem_resposta";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString();
}

const STATUS_ESTADO: Record<string, string> = {
  CLOSED: "fechada",
  OPEN: "aberta",
  PENDING: "pendente",
};

function ConversationList({
  conversations,
  onSelect,
  selectedId,
  t,
}: {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  t: (k: string) => string;
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Icon className="text-4xl text-on-surface-variant/40" name="forum" />
        <p className="mt-3 font-semibold text-on-surface-variant text-sm">
          {t("inbox.empty")}
        </p>
      </div>
    );
  }
  return (
    <div className="divide-y divide-outline-variant/40">
      {conversations.map((c) => (
        <button
          className={`flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-container ${selectedId === c.id ? "bg-surface-container" : ""}`}
          key={c.id}
          onClick={() => onSelect(c.id)}
          type="button"
        >
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
            <Icon
              className="text-lg text-on-surface-variant"
              name={CHANNEL_ICON[c.channel] ?? "chat"}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-on-surface text-sm">
                {c.customer?.name ?? c.phone}
              </span>
              {c.escalatedAt && (
                <Icon
                  className="shrink-0 text-base text-warning"
                  name="priority_high"
                />
              )}
              <span className="ms-auto shrink-0 text-on-surface-variant text-xs">
                {timeLabel(c.lastMessageAt)}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="truncate text-on-surface-variant text-xs">
                {c.lastMessagePreview}
              </p>
              {c.unreadCount > 0 && (
                <span className="ms-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-bold text-[11px] text-on-primary">
                  {c.unreadCount}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ m, t }: { m: Message; t: (k: string) => string }) {
  const inbound = m.direction === "INBOUND";
  let por: string | null = m.createdBy?.name ?? null;
  if (m.handledBy === "BOT") {
    por = t("inbox.by_bot");
  } else if (m.handledBy === "SYSTEM") {
    por = t("inbox.by_system");
  }
  return (
    <div className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          inbound
            ? "rounded-bl-sm bg-surface-container text-on-surface"
            : "rounded-br-sm bg-primary/10 text-on-surface"
        }`}
      >
        <p className="whitespace-pre-wrap text-sm">{m.body}</p>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-on-surface-variant">
          {!inbound && por && <span>{por} ·</span>}
          <span>{timeLabel(m.receivedAt)}</span>
          {!inbound && m.deliveryStatus === "FAILED" && (
            <span className="text-error">{t("inbox.send_failed")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const { t } = useTranslation();
  const enabled = useAiInboxStore((s) => s.enabled);
  const fetchStatus = useAiInboxStore((s) => s.fetchStatus);
  const me = useAuthStore((s) => s.user);
  const canManage = useCan({ inbox: ["manage"] });
  const canSend = useCan({ inbox: ["send"] });

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [channel, setChannel] = useState("");
  const [replyText, setReplyText] = useState("");
  // Um rascunho por conversa — sem isto o texto escrito na conversa A
  // aparecia no compositor da conversa B ao trocar de seleção.
  const [draftsByConv, setDraftsByConv] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  // Ref (não state): dois Enter no mesmo tick liam sending=false — o
  // servidor criava um rascunho por pedido e o cliente recebia a
  // resposta em duplicado (BUG #164 r8).
  const sendingRef = useRef(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (enabled === null) {
      fetchStatus().catch(() => undefined);
    }
  }, [enabled, fetchStatus]);

  const loadConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter) {
        params.set("filtro", filter);
      }
      if (channel) {
        params.set("canal", channel);
      }
      const res = await api.get(`/inbox/conversations?${params.toString()}`);
      setConversations(res.data.data ?? []);
      setNotEnabled(false);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "CLOUD_MODULE_REQUIRED" || code === "FORBIDDEN") {
        setNotEnabled(true);
      }
    }
  }, [filter, channel]);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await api.get("/inbox/drafts");
      setDrafts(res.data.data ?? []);
    } catch {
      // drafts são secundários — sem ruído
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    try {
      const res = await api.get(`/inbox/conversations/${id}/messages`, {
        params: { limite: 50 },
      });
      setMessages([...(res.data.data ?? [])].reverse());
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    loadConversations().catch(() => undefined);
    loadDrafts().catch(() => undefined);
    const timer = setInterval(() => {
      loadConversations().catch(() => undefined);
      if (selectedId) {
        loadMessages(selectedId).catch(() => undefined);
      }
      loadDrafts().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadConversations, loadDrafts, loadMessages, selectedId]);

  useEffect(() => {
    if (canManage) {
      api
        .get("/users")
        .then((res) => setUsers(res.data.data ?? res.data ?? []))
        .catch(() => setUsers([]));
    }
  }, [canManage]);

  async function openConversation(id: string) {
    if (id !== selectedId) {
      // Persiste o rascunho da conversa anterior e restaura o desta —
      // cada conversa tem o seu, nunca o texto de outra.
      const next = { ...draftsByConv };
      if (selectedId) {
        if (replyText.trim()) {
          next[selectedId] = replyText;
        } else {
          delete next[selectedId];
        }
      }
      setDraftsByConv(next);
      setReplyText(next[id] ?? "");
    }
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const res = await api.get(`/inbox/conversations/${id}`);
      setSelected(res.data.data);
      await loadMessages(id);
      const conv = conversations.find((c) => c.id === id);
      if (conv && conv.unreadCount > 0 && canSend) {
        await api.post(`/inbox/conversations/${id}/read`).catch(() => null);
        setConversations((list) =>
          list.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c))
        );
      }
    } catch {
      setSelected(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (messages.length > 0) {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
    }
  }, [messages]);

  async function act(promise: Promise<unknown>, refresh = true) {
    try {
      await promise;
      if (refresh && selectedId) {
        await Promise.all([loadConversations(), loadMessages(selectedId)]);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t("inbox.action_error")));
    }
  }

  async function sendReply() {
    if (!(selectedId && replyText.trim()) || sendingRef.current) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      await api.post(`/inbox/conversations/${selectedId}/reply`, {
        texto: replyText.trim(),
      });
      setReplyText("");
      setDraftsByConv((prev) => {
        const next = { ...prev };
        delete next[selectedId];
        return next;
      });
      await loadMessages(selectedId);
    } catch (err) {
      toast.error(getErrorMessage(err, t("inbox.send_error")));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  if (enabled === false || notEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Icon className="text-5xl text-on-surface-variant/40" name="forum" />
        <h1 className="mt-4 font-bold text-on-surface text-xl">
          {t("inbox.title")}
        </h1>
        <p className="mt-2 max-w-md text-on-surface-variant text-sm">
          {t("inbox.module_required")}
        </p>
      </div>
    );
  }

  const FILTERS: { key: Filter | null; label: string }[] = [
    { key: null, label: t("inbox.filter_all") },
    { key: "nao_lidas", label: t("inbox.filter_unread") },
    { key: "sem_resposta", label: t("inbox.filter_unanswered") },
    { key: "atribuidas_a_mim", label: t("inbox.filter_mine") },
    { key: "escaladas", label: t("inbox.filter_escalated") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-extrabold font-headline text-2xl text-on-surface">
          {t("inbox.title")}
        </h1>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select
              aria-label={t("inbox.channel_filter")}
              onChange={(e) => setChannel(e.target.value)}
              value={channel}
            >
              <option value="">{t("inbox.channel_all")}</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="evolution">Evolution</option>
              <option value="sms">SMS</option>
            </Select>
          </div>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            className={`rounded-full px-4 py-1.5 font-medium text-sm transition-colors ${
              filter === f.key
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
            key={f.label}
            onClick={() => setFilter(f.key)}
            type="button"
          >
            {f.label}
          </button>
        ))}
      </div>

      {drafts.length > 0 && (
        <div className="mb-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <p className="font-bold text-on-surface text-sm">
            {t("inbox.drafts_pending", { count: drafts.length })}
          </p>
          <div className="mt-2 space-y-2">
            {drafts.map((d) => (
              <div
                className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container-lowest p-3"
                key={d.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {d.conversation.customer?.name ?? d.conversation.phone} ·{" "}
                    {d.conversation.channel}
                  </p>
                  <p className="truncate text-on-surface-variant text-xs">
                    {d.text}
                  </p>
                </div>
                {canSend && (
                  <div className="flex gap-2">
                    <button
                      className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-on-primary text-xs"
                      onClick={() =>
                        act(api.post(`/inbox/drafts/${d.id}/approve`)).then(
                          () => loadDrafts()
                        )
                      }
                      type="button"
                    >
                      {t("inbox.draft_approve")}
                    </button>
                    <button
                      className="rounded-lg bg-surface-container px-3 py-1.5 font-semibold text-on-surface-variant text-xs"
                      onClick={() =>
                        act(
                          api
                            .post(`/inbox/drafts/${d.id}/reject`)
                            .then((res) => {
                              if (res.data?.reconciled) {
                                toast.info(t("inbox.draft_already_sent"));
                              }
                              return loadDrafts();
                            })
                        )
                      }
                      type="button"
                    >
                      {t("inbox.draft_reject")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="oos-scrollbar min-h-0 overflow-y-auto rounded-2xl bg-surface-container-low">
          <ConversationList
            conversations={conversations}
            onSelect={openConversation}
            selectedId={selectedId}
            t={t}
          />
        </div>

        <div className="flex min-h-0 flex-col rounded-2xl bg-surface-container-low lg:col-span-2">
          {!selected && (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-on-surface-variant text-sm">
              {loadingDetail ? t("loading") : t("inbox.select_hint")}
            </div>
          )}
          {selected && (
            <>
              <div className="flex flex-wrap items-center gap-3 border-outline-variant/40 border-b p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-on-surface">
                    {selected.customer?.name ?? selected.phone}
                  </p>
                  <p className="text-on-surface-variant text-xs">
                    {selected.phone} · {selected.channel}
                  </p>
                </div>
                {canManage && (
                  <div className="w-44">
                    <Select
                      aria-label={t("inbox.assign")}
                      onChange={(e) => {
                        if (e.target.value) {
                          act(
                            api.post(
                              `/inbox/conversations/${selected.id}/assign`,
                              {
                                utilizadorId: e.target.value,
                              }
                            )
                          );
                        }
                      }}
                      value={selected.assignedTo?.id ?? ""}
                    >
                      <option value="">{t("inbox.unassigned")}</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="w-40">
                  <Select
                    aria-label={t("inbox.status")}
                    onChange={(e) => {
                      if (e.target.value) {
                        act(
                          api.post(
                            `/inbox/conversations/${selected.id}/status`,
                            {
                              estado: e.target.value,
                            }
                          )
                        );
                      }
                    }}
                    value={STATUS_ESTADO[selected.status] ?? "fechada"}
                  >
                    <option value="aberta">{t("inbox.status_open")}</option>
                    <option value="pendente">
                      {t("inbox.status_pending")}
                    </option>
                    <option value="fechada">{t("inbox.status_closed")}</option>
                  </Select>
                </div>
              </div>
              <div
                className="oos-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
                ref={threadRef}
              >
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} t={t} />
                ))}
              </div>
              {canSend && (
                <div className="flex items-end gap-2 border-outline-variant/40 border-t p-4">
                  <textarea
                    aria-label={t("inbox.reply_placeholder")}
                    className="min-h-11 flex-1 resize-none rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 text-sm"
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                    placeholder={t("inbox.reply_placeholder")}
                    rows={2}
                    value={replyText}
                  />
                  <button
                    aria-label={t("inbox.send")}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-on-primary text-sm disabled:opacity-50"
                    disabled={sending || !replyText.trim()}
                    onClick={sendReply}
                    type="button"
                  >
                    <Icon name="send" size="md" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <p className="sr-only">{me?.name}</p>
    </div>
  );
}
