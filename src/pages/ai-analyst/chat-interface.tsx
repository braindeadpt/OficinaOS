import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import AgentSelector from "@/components/modules/ai-analyst/agent-selector";
import ChatEmptyState from "@/components/modules/ai-analyst/chat-empty-state";
import { Button } from "@/components/ui/button";
import { useModalEffects } from "@/hooks/use-modal-effects";
import api, { fetchCsrfToken } from "@/lib/api";
import { useAiChatStore } from "@/stores/ai-chat";

const MarkdownRenderer = React.lazy(() => import("./markdown-renderer"));

type MessageRole = "user" | "assistant";
type ToolCallStatus = "running" | "completed";

interface ToolCallEvent {
  isSubAgent?: boolean;
  result?: string;
  status: ToolCallStatus;
  tool: string;
}

interface SerializedMessage {
  agentName: string | null;
  content: string | null;
  createdAt: string;
  id: string;
  role: string;
  toolCalls: unknown | null;
}

interface ChatMessage {
  agentName?: string;
  content: string;
  error?: string;
  errorRecovered?: boolean;
  errorType?: string;
  id: string;
  isStreaming?: boolean;
  role: MessageRole;
  timestamp: Date;
  toolCalls?: ToolCallEvent[];
}

interface AgentOption {
  description?: string;
  displayName: string;
  name: string;
}

type StreamEvent =
  | { agentName?: string; delta: string; type: "content" }
  | { errorType?: string; message: string; recovered?: boolean; type: "error" }
  | { type: "done" }
  | {
      isSubAgent?: boolean;
      result?: string;
      status: ToolCallStatus;
      tool: string;
      type: "tool_call";
    }
  | { title: string; type: "title" };

const RETRYABLE_ERROR_TYPES = new Set([
  "toolTimeout",
  "toolCallFailed",
  "transientRetry",
  "invalidToolInput",
]);

const LEADING_HEADING_REGEX = /^#*\s*/;

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  getSchema: "ai_agent_tool_name_get_schema",
  queryDatabase: "ai_agent_tool_name_query_database",
};

const TOOL_RUNNING_LABELS: Record<string, string> = {
  getSchema: "ai_agent_tool_get_schema",
  queryDatabase: "ai_agent_tool_query_database",
};

const AGENT_NAME_STORAGE_KEY = "ai-agent-name";
const DEFAULT_AGENT = "general_assistant";

function formatTimestamp(timestamp: Date): string {
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toChatMessage(message: SerializedMessage): ChatMessage {
  const parsedToolCalls = Array.isArray(message.toolCalls)
    ? (message.toolCalls as ToolCallEvent[])
    : undefined;

  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content ?? "",
    agentName: message.agentName ?? undefined,
    timestamp: new Date(message.createdAt),
    toolCalls: parsedToolCalls,
  };
}

function TypingIndicator({ activeToolName }: { activeToolName?: string }) {
  return (
    <div className="flex items-end gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <span
          className="material-symbols-outlined text-primary text-xl"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          auto_awesome
        </span>
      </div>
      <div className="flex items-center rounded-2xl rounded-ss-sm bg-surface-container-lowest px-4 py-3 shadow-sm">
        {activeToolName && (
          <p className="me-3 text-on-surface-variant text-xs">
            {activeToolName}
          </p>
        )}
        <div className="flex gap-1.5">
          <span className="typing-dot h-2 w-2 rounded-full bg-on-surface-variant/40" />
          <span className="typing-dot h-2 w-2 rounded-full bg-on-surface-variant/40" />
          <span className="typing-dot h-2 w-2 rounded-full bg-on-surface-variant/40" />
        </div>
      </div>
    </div>
  );
}

const MessageBubble = React.memo(function MessageBubble({
  message,
}: {
  message: ChatMessage;
}) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-3">
        <div className="flex max-w-[80%] flex-col items-end space-y-1.5 sm:max-w-[70%]">
          <article className="rounded-2xl rounded-se-sm bg-primary px-4 py-3 text-on-primary text-sm leading-relaxed">
            {message.content}
          </article>
          <span className="me-1 font-bold text-on-surface-variant text-xs uppercase tracking-wider">
            {t("ai_agent_role_user")} &bull;{" "}
            {formatTimestamp(message.timestamp)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-primary text-xl"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          auto_awesome
        </span>
      </div>
      <div className="flex max-w-[80%] flex-col space-y-1.5 sm:max-w-[70%]">
        <article className="rounded-2xl rounded-ss-sm bg-surface-container-lowest px-4 py-3 text-on-surface text-sm leading-relaxed shadow-sm">
          {message.isStreaming && !message.content ? null : (
            <React.Suspense
              fallback={
                <span className="text-on-surface-variant text-xs">
                  {message.content}
                </span>
              }
            >
              <MarkdownRenderer content={message.content} />
            </React.Suspense>
          )}
        </article>
        <span className="ms-1 font-bold text-on-surface-variant text-xs uppercase tracking-wider">
          {message.agentName ?? t("ai_agent_role_assistant")} &bull;{" "}
          {formatTimestamp(message.timestamp)}
        </span>
      </div>
    </div>
  );
});

function ToolCallAccordion({ toolCalls }: { toolCalls: ToolCallEvent[] }) {
  const { t } = useTranslation();
  const allDone = toolCalls.every((tc) => tc.status === "completed");
  const [isOpen, setIsOpen] = useState(!allDone);

  return (
    <div className="ms-13 w-fit overflow-hidden rounded-lg border border-outline-variant bg-surface-container-low text-xs">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-container-high"
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        {allDone ? (
          <span className="material-symbols-outlined text-primary text-sm">
            check_circle
          </span>
        ) : (
          <span className="material-symbols-outlined animate-spin text-on-surface-variant text-sm">
            progress_activity
          </span>
        )}
        <span className="font-medium">
          {allDone
            ? t("ai_agent_tool_used", { count: toolCalls.length })
            : t("ai_agent_tool_analyzing")}
        </span>
        <span
          className={`material-symbols-outlined ms-auto text-on-surface-variant text-sm transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
        >
          arrow_right
        </span>
      </button>
      {isOpen && (
        <div className="border-outline-variant border-t px-3 py-1.5">
          {toolCalls.map((toolCall) => {
            const i18nKey = TOOL_DISPLAY_NAMES[toolCall.tool];
            const displayName = i18nKey ? t(i18nKey) : toolCall.tool;

            return (
              <div
                className="flex items-center gap-2 py-0.5"
                key={`${toolCall.tool}-${toolCall.status}`}
              >
                {toolCall.status === "completed" ? (
                  <span className="material-symbols-outlined text-primary text-sm">
                    check_circle
                  </span>
                ) : (
                  <span className="material-symbols-outlined animate-spin text-on-surface-variant text-sm">
                    progress_activity
                  </span>
                )}
                <span className="text-on-surface-variant">{displayName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const MessageExtras = React.memo(function MessageExtras({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry: (messageId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {message.toolCalls && message.toolCalls.length > 0 && (
        <ToolCallAccordion toolCalls={message.toolCalls} />
      )}
      {message.error && (
        <div
          className={`ms-13 flex flex-col gap-1 rounded-lg border px-3 py-2 text-xs ${
            message.errorRecovered
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.errorType && (
              <span
                className={`rounded px-1.5 py-0.5 font-medium font-mono text-[10px] ${
                  message.errorRecovered ? "bg-primary/20" : "bg-error/20"
                }`}
              >
                {message.errorType}
              </span>
            )}
            <span>{message.error}</span>
          </div>
          {!message.errorRecovered && (
            <div className="flex items-center gap-2">
              {message.errorType &&
                RETRYABLE_ERROR_TYPES.has(message.errorType) && (
                  <span className="text-on-surface-variant">
                    {t("ai_agent_tool_error_suggestion")}
                  </span>
                )}
              <button
                className="rounded-lg border border-outline-variant px-3 py-1 font-medium text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high"
                onClick={() => onRetry(message.id)}
                type="button"
              >
                {t("ai_agent_retry")}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
});

function AgentSwitchDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalEffects(open, onCancel, dialogRef);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-container-high p-6 shadow-xl"
        ref={dialogRef}
      >
        <h3 className="mb-2 font-bold text-lg text-on-surface">
          {t("ai_agent_agent_switch_title")}
        </h3>
        <p className="mb-5 text-on-surface-variant text-sm">
          {t("ai_agent_agent_switch_desc")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl px-4 py-2 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
            onClick={onCancel}
            type="button"
          >
            {t("cancel")}
          </button>
          <Button onClick={onConfirm} size="sm">
            {t("confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewConversationDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalEffects(open, onCancel, dialogRef);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-2xl bg-surface-container-high p-6 shadow-xl"
        ref={dialogRef}
      >
        <h3 className="mb-2 font-bold text-lg text-on-surface">
          {t("ai_agent_new_conversation_title")}
        </h3>
        <p className="mb-5 text-on-surface-variant text-sm">
          {t("ai_agent_new_conversation_desc")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-xl px-4 py-2 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
            onClick={onCancel}
            type="button"
          >
            {t("cancel")}
          </button>
          <Button onClick={onConfirm} size="sm">
            {t("confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ChatInterfaceProps {
  agentEnabled?: boolean;
}

function ChatInterface({ agentEnabled = true }: ChatInterfaceProps) {
  const { t, i18n } = useTranslation();
  const activeConversationId = useAiChatStore((s) => s.activeConversationId);
  const getDraft = useAiChatStore((s) => s.getDraft);
  const setDraft = useAiChatStore((s) => s.setDraft);
  const setMobileSheetOpen = useAiChatStore((s) => s.setMobileSheetOpen);
  const triggerRefresh = useAiChatStore((s) => s.triggerRefresh);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [agentName, setAgentName] = useState(
    () => localStorage.getItem(AGENT_NAME_STORAGE_KEY) ?? DEFAULT_AGENT
  );
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [agentSwitchPending, setAgentSwitchPending] = useState<string | null>(
    null
  );
  const [newConvPending, setNewConvPending] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 100;
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isTyping && !userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isTyping]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    api
      .get<
        Array<{
          displayName: string;
          instructions?: string;
          isActive: boolean;
          name: string;
        }>
      >("/ai/definitions")
      .then(({ data: definitions }) => {
        const options = definitions
          .filter((d) => d.isActive && d.name !== "triage")
          .map((d) => {
            let description: string | undefined;
            if (d.instructions) {
              const firstLine = d.instructions
                .split("\n")
                .find((line) => line.trim().length > 0);
              if (firstLine) {
                description = firstLine
                  .replace(LEADING_HEADING_REGEX, "")
                  .trim();
              }
            }
            return {
              name: d.name,
              displayName: d.displayName,
              description,
            };
          });
        setAgentOptions(options);
      })
      .catch((err) => {
        console.error("Failed to fetch agent definitions:", err);
        setAgentOptions([]);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(AGENT_NAME_STORAGE_KEY, agentName);
  }, [agentName]);

  const inputTrimRef = useRef("");
  inputTrimRef.current = input.trim();
  const inputRef_value = useRef(input);
  inputRef_value.current = input;
  const messagesLengthRef = useRef(0);
  messagesLengthRef.current = messages.length;

  useEffect(() => {
    if (conversationIdRef.current && inputTrimRef.current) {
      setDraft(conversationIdRef.current, inputRef_value.current);
    }

    if (activeConversationId === null) {
      if (messagesLengthRef.current > 0) {
        setNewConvPending(true);
      } else {
        abortRef.current?.abort();
        abortRef.current = null;
        setConversationId(null);
        conversationIdRef.current = null;
        setMessages([]);
        setInput("");
      }
      return;
    }

    if (activeConversationId === conversationIdRef.current) {
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;
    setConversationId(activeConversationId);
    conversationIdRef.current = activeConversationId;
    setMessages([]);
    setIsTyping(false);

    api
      .get<{ items: SerializedMessage[] }>(
        `/ai/${activeConversationId}/messages`,
        { params: { page: 1, limit: 100 } }
      )
      .then(({ data }) => {
        setMessages(data.items.map(toChatMessage));
        setInput(getDraft(activeConversationId));
        scrollToBottom();
      })
      .catch(() => {
        setMessages([]);
        toast.error(t("ai_agent_failed_load"));
      });
  }, [activeConversationId, getDraft, scrollToBottom, setDraft, t]);

  const updateLastAssistant = useCallback(
    (updater: (message: ChatMessage) => ChatMessage): void => {
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i]?.role === "assistant") {
            next[i] = updater(next[i] as ChatMessage);
            return next;
          }
        }
        return prev;
      });
    },
    []
  );

  const applyStreamEvent = useCallback(
    (event: StreamEvent): void => {
      if (event.type === "content") {
        updateLastAssistant((message) => ({
          ...message,
          content: `${message.content}${event.delta}`,
          agentName: event.agentName ?? message.agentName,
        }));
        return;
      }

      if (event.type === "tool_call") {
        updateLastAssistant((message) => {
          const current = message.toolCalls ?? [];
          const existingIndex = current.findIndex(
            (tc) => tc.tool === event.tool && tc.status === "running"
          );
          if (existingIndex >= 0 && event.status === "completed") {
            const updated = [...current];
            updated[existingIndex] = {
              tool: event.tool,
              status: event.status,
              result: event.result,
              isSubAgent: event.isSubAgent,
            };
            return { ...message, toolCalls: updated };
          }
          return {
            ...message,
            toolCalls: [
              ...current,
              {
                tool: event.tool,
                status: event.status,
                result: event.result,
                isSubAgent: event.isSubAgent,
              },
            ],
          };
        });
        return;
      }

      if (event.type === "error") {
        updateLastAssistant((message) => ({
          ...message,
          error: event.message || t("ai_agent_stream_error"),
          errorType: event.errorType,
          errorRecovered: event.recovered ?? false,
          isStreaming: false,
        }));
        setIsTyping(false);
        return;
      }

      if (event.type === "title") {
        triggerRefresh();
        return;
      }

      if (event.type === "done") {
        updateLastAssistant((message) => ({ ...message, isStreaming: false }));
        setIsTyping(false);
      }
    },
    [t, triggerRefresh, updateLastAssistant]
  );

  const parseSseChunk = useCallback(
    (chunk: string, onEvent: (event: StreamEvent) => void): void => {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) {
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload) {
          continue;
        }
        if (payload === "[DONE]") {
          onEvent({ type: "done" });
          continue;
        }
        try {
          const data = JSON.parse(payload) as StreamEvent;
          onEvent(data);
        } catch {
          onEvent({
            type: "error",
            message: t("ai_agent_stream_error"),
          });
        }
      }
    },
    [t]
  );

  const readSseResponse = useCallback(
    async (response: Response): Promise<void> => {
      const reader = response.body?.getReader();
      if (!reader) {
        applyStreamEvent({
          type: "error",
          message: t("ai_agent_stream_error"),
        });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          parseSseChunk(block, applyStreamEvent);
        }
      }

      if (buffer) {
        parseSseChunk(buffer, applyStreamEvent);
      }
    },
    [applyStreamEvent, parseSseChunk, t]
  );

  const buildStreamRequest = useCallback(
    async (trimmed: string, signal: AbortSignal): Promise<Response> => {
      const baseURL = import.meta.env.VITE_API_BASE_URL || "";
      const csrf = await fetchCsrfToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (csrf) {
        headers["X-CSRF-Token"] = csrf;
      }
      return fetch(`${baseURL}/api/ai/chat/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: trimmed,
          conversationId,
          agentName,
          language: i18n.language,
        }),
        credentials: "include",
        signal,
      });
    },
    [conversationId, agentName, i18n.language]
  );

  const handleStreamError = useCallback(
    async (response: Response): Promise<string> => {
      let errorMessage = t("ai_agent_stream_error");
      try {
        const body = (await response.json()) as {
          error?: string;
          message?: string;
        };
        if (body.message) {
          errorMessage = body.message;
        } else if (body.error) {
          errorMessage = body.error;
        }
      } catch {
        // use default error message
      }
      return errorMessage;
    },
    [t]
  );

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed || isTyping || !agentEnabled) {
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          timestamp: new Date(),
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        },
      ]);
      setInput("");
      setIsTyping(true);
      scrollToBottom();

      try {
        const response = await buildStreamRequest(trimmed, controller.signal);

        if (!response.ok) {
          const errorMessage = await handleStreamError(response);
          applyStreamEvent({ type: "error", message: errorMessage });
          return;
        }

        const nextConversationId = response.headers.get("X-Conversation-Id");
        if (nextConversationId) {
          setConversationId(nextConversationId);
          conversationIdRef.current = nextConversationId;
        }

        await readSseResponse(response);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        applyStreamEvent({
          type: "error",
          message: t("ai_agent_stream_error"),
        });
      } finally {
        setIsTyping(false);
        scrollToBottom();
        inputRef.current?.focus();
        abortRef.current = null;
      }
    },
    [
      isTyping,
      agentEnabled,
      scrollToBottom,
      buildStreamRequest,
      handleStreamError,
      applyStreamEvent,
      readSseResponse,
      t,
    ]
  );

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>): void => {
      e.preventDefault();
      sendMessageRef.current(input);
    },
    [input]
  );

  const handleRetry = useCallback(
    (messageId: string): void => {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index <= 0) {
        return;
      }
      for (let i = index - 1; i >= 0; i--) {
        const candidate = messages[i];
        if (candidate?.role === "user") {
          sendMessageRef.current(candidate.content);
          return;
        }
      }
    },
    [messages]
  );

  const handleResetConversation = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    setConversationId(null);
    setMessages([]);
  }, []);

  const handleStop = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    updateLastAssistant((message) => ({ ...message, isStreaming: false }));
    setIsTyping(false);
  }, [updateLastAssistant]);

  const handleCopyConversation = useCallback(async (): Promise<void> => {
    const roleLabel = (role: MessageRole): string =>
      role === "user" ? t("ai_agent_role_user") : t("ai_agent_role_assistant");

    const formatted = messages
      .map((message) => {
        const timestamp = formatTimestamp(message.timestamp);
        return `[${roleLabel(message.role)} - ${timestamp}]\n${message.content}`;
      })
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(formatted);
      toast.success(t("ai_agent_conversation_copied"));
    } catch {
      toast.error(t("ai_agent_conversation_copy_failed"));
    }
  }, [messages, t]);

  const hasMessages = messages.length > 0;

  const activeToolName = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) {
        continue;
      }
      if (msg.role === "assistant") {
        const activeTool = msg.toolCalls?.find(
          (tc) => tc.status !== "completed"
        );
        if (activeTool) {
          const i18nKey = TOOL_RUNNING_LABELS[activeTool.tool];
          return i18nKey ? t(i18nKey) : t("ai_agent_tool_analyzing");
        }
        break;
      }
    }
    return;
  }, [messages, t]);

  const handleConfirmAgentSwitch = useCallback(() => {
    if (agentSwitchPending) {
      handleResetConversation();
      setAgentName(agentSwitchPending);
      setAgentSwitchPending(null);
    }
  }, [agentSwitchPending, handleResetConversation]);

  const handleConfirmNewConversation = useCallback(() => {
    handleResetConversation();
    setNewConvPending(false);
  }, [handleResetConversation]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-conversation-id={conversationId ?? undefined}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 bg-surface-container-low px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            aria-label={t("ai_agent_open_panel")}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-highest lg:hidden"
            onClick={() => setMobileSheetOpen(true)}
            type="button"
          >
            <span className="material-symbols-outlined text-xl">menu</span>
          </button>
          <h1 className="font-bold font-headline text-lg text-on-surface">
            {t("ai_agent_title")}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            aria-label={t("ai_agent_open_settings")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
            to="/settings?tab=ai"
          >
            <span className="material-symbols-outlined text-xl">settings</span>
          </Link>
          {hasMessages && (
            <button
              aria-label={t("ai_agent_copy_conversation")}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
              onClick={handleCopyConversation}
              type="button"
            >
              <span className="material-symbols-outlined text-xl">
                content_copy
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 bg-surface-container px-4 py-2">
        <AgentSelector
          agentName={agentName}
          agentOptions={agentOptions}
          onAgentSwitch={(name) => {
            if (hasMessages) {
              setAgentSwitchPending(name);
            } else {
              setAgentName(name);
            }
          }}
        />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {!agentEnabled && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <span className="material-symbols-outlined text-2xl text-primary">
                  auto_awesome
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <p className="font-medium text-on-surface text-sm">
                  {t("ai_agent_disabled")}
                </p>
                <p className="text-on-surface-variant text-xs">
                  {t("ai_agent_disabled_desc")}
                </p>
              </div>
              <Link
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-on-primary text-sm transition-colors hover:opacity-90"
                to="/settings?tab=ai"
              >
                <span className="material-symbols-outlined text-base">
                  settings
                </span>
                {t("ai_agent_open_settings")}
              </Link>
            </div>
          </div>
        )}

        {hasMessages ? (
          <div
            aria-label={t("ai_agent_title")}
            aria-live="polite"
            className="flex-1 overflow-y-auto p-4 md:p-6"
            ref={scrollContainerRef}
            role="log"
          >
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((message) => (
                <div className="flex flex-col gap-2" key={message.id}>
                  <MessageBubble message={message} />
                  <MessageExtras message={message} onRetry={handleRetry} />
                </div>
              ))}
              {isTyping && <TypingIndicator activeToolName={activeToolName} />}
              {isTyping && (
                <div aria-live="polite" className="sr-only">
                  {activeToolName ?? t("ai_agent_typing")}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        ) : (
          <ChatEmptyState
            agentEnabled={agentEnabled}
            onSendMessage={(msg) => sendMessageRef.current(msg)}
          />
        )}

        <div className="shrink-0 border-outline-variant border-t bg-surface-container-lowest px-4 py-3 md:px-6">
          <form
            className="mx-auto flex max-w-3xl gap-2"
            onSubmit={handleSubmit}
          >
            <label className="sr-only" htmlFor="agent-chat-input">
              {t("ai_agent_placeholder")}
            </label>
            <input
              autoComplete="off"
              className="flex-1 rounded-xl bg-surface-container-high px-4 py-2.5 text-on-surface text-sm placeholder:text-on-surface-variant/50"
              disabled={isTyping || !agentEnabled}
              id="agent-chat-input"
              name="agentChatInput"
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("ai_agent_placeholder")}
              ref={inputRef}
              value={input}
            />
            {isTyping ? (
              <Button
                aria-label={t("ai_agent_stop")}
                className="shrink-0"
                icon="stop"
                iconOnly
                onClick={handleStop}
                size="md"
                type="button"
                variant="ghost"
              />
            ) : (
              <Button
                aria-label={t("ai_agent_send")}
                className="shrink-0"
                disabled={!(input.trim() && agentEnabled)}
                icon="send"
                iconOnly
                size="md"
                type="submit"
              />
            )}
          </form>
          {!isTyping && agentEnabled && (
            <p className="mx-auto mt-1.5 hidden max-w-3xl items-center gap-1.5 text-on-surface-variant text-xs lg:flex">
              <span className="material-symbols-outlined text-sm">
                keyboard
              </span>
              <span>
                {t("ai_agent_press")}{" "}
                <span className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-[10px]">
                  {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"} + Enter
                </span>{" "}
                {t("ai_agent_to_send")}
              </span>
            </p>
          )}
          {isTyping && (
            <p className="mx-auto mt-1.5 max-w-3xl text-on-surface-variant text-xs">
              {activeToolName ?? t("ai_agent_typing")}
            </p>
          )}
        </div>
      </div>

      <AgentSwitchDialog
        onCancel={() => setAgentSwitchPending(null)}
        onConfirm={handleConfirmAgentSwitch}
        open={agentSwitchPending !== null}
      />

      <NewConversationDialog
        onCancel={() => setNewConvPending(false)}
        onConfirm={handleConfirmNewConversation}
        open={newConvPending}
      />
    </div>
  );
}

export default ChatInterface;
