import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import api, { getErrorMessage } from "@/lib/api";
import { useAiInboxStore } from "@/stores/ai-inbox";

/**
 * «Ligar a outra IA» (§G.9) — staff usa qualquer LLM (Claude, ChatGPT,
 * Cursor, Ollama) para gerir a caixa de entrada via MCP na Cloud.
 * Tokens pessoais, «permitir envio direto pelo MCP» (off, com aviso de
 * risco) e retenção configurável — tudo gated pelo entitlement.
 */

const MCP_URL = "https://cloud.oficinaos.app/mcp";

interface McpToken {
  createdAt?: string;
  id: string;
  label?: string;
  lastUsedAt?: string | null;
  token?: string; // só no create — a Cloud só o mostra uma vez
}

function clientConfig(client: string): string {
  switch (client) {
    case "claude":
      return JSON.stringify(
        { mcpServers: { oficinaos: { url: MCP_URL } } },
        null,
        2
      );
    case "chatgpt":
      return JSON.stringify(
        { mcp: { servers: { oficinaos: { url: MCP_URL } } } },
        null,
        2
      );
    case "cursor":
      return JSON.stringify(
        {
          mcpServers: {
            oficinaos: {
              headers: { Authorization: "Bearer <TOKEN>" },
              url: MCP_URL,
            },
          },
        },
        null,
        2
      );
    default:
      return JSON.stringify({ mcp: { oficinaos: { url: MCP_URL } } }, null, 2);
  }
}

function CopyButton({ text, t }: { text: string; t: (k: string) => string }) {
  return (
    <button
      className="flex min-h-9 items-center gap-1.5 rounded-lg bg-surface-container px-3 py-1.5 font-medium text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => toast.success(t("inbox.mcp_copied")),
          () => toast.error(t("inbox.action_error"))
        );
      }}
      type="button"
    >
      <Icon name="content_copy" size="sm" />
      {t("inbox.mcp_copy")}
    </button>
  );
}

export default function SettingsAiInboxSection() {
  const { t } = useTranslation();
  const enabled = useAiInboxStore((s) => s.enabled);
  const fetchStatus = useAiInboxStore((s) => s.fetchStatus);

  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [directSend, setDirectSend] = useState(false);
  const [retention, setRetention] = useState("365");
  const [client, setClient] = useState("claude");
  const [newToken, setNewToken] = useState<string | null>(null);

  useEffect(() => {
    if (enabled === null) {
      fetchStatus().catch(() => undefined);
    }
  }, [enabled, fetchStatus]);

  const loadTokens = useCallback(async () => {
    try {
      const res = await api.get("/inbox/mcp/tokens");
      const list = (res.data?.data ?? res.data?.tokens ?? []) as McpToken[];
      setTokens(Array.isArray(list) ? list : []);
    } catch {
      setTokens([]);
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await api.get("/inbox/mcp/preferences");
      setDirectSend(res.data?.mcpDirectSend === true);
    } catch {
      // sem módulo/permissão — off
    }
  }, []);

  const loadRetention = useCallback(async () => {
    try {
      const res = await api.get("/settings/shop");
      const days = res.data?.inboxRetentionDays;
      if (typeof days === "number") {
        setRetention(String(days));
      }
    } catch {
      // default fica
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      loadTokens().catch(() => undefined);
      loadPrefs().catch(() => undefined);
      loadRetention().catch(() => undefined);
    }
  }, [enabled, loadTokens, loadPrefs, loadRetention]);

  if (!enabled) {
    return null;
  }

  async function createToken() {
    if (!label.trim()) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.post("/inbox/mcp/tokens", { label: label.trim() });
      const tok = res.data?.token ?? res.data?.data?.token ?? null;
      setNewToken(typeof tok === "string" ? tok : null);
      setLabel("");
      await loadTokens();
    } catch (err) {
      toast.error(getErrorMessage(err, t("inbox.action_error")));
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string) {
    setBusy(true);
    try {
      await api.delete(`/inbox/mcp/tokens/${id}`);
      await loadTokens();
    } catch (err) {
      toast.error(getErrorMessage(err, t("inbox.action_error")));
    } finally {
      setBusy(false);
    }
  }

  async function saveDirectSend(value: boolean) {
    setDirectSend(value);
    try {
      await api.put("/inbox/mcp/preferences", { mcpDirectSend: value });
    } catch (err) {
      setDirectSend(!value);
      toast.error(getErrorMessage(err, t("inbox.action_error")));
    }
  }

  async function saveRetention() {
    const days = Number.parseInt(retention, 10);
    if (!(days >= 30 && days <= 3650)) {
      toast.error(t("inbox.retention_invalid"));
      return;
    }
    try {
      await api.put("/settings/shop", { inboxRetentionDays: days });
      toast.success(t("inbox.saved"));
    } catch (err) {
      toast.error(getErrorMessage(err, t("settings_save_error")));
    }
  }

  return (
    <div className="space-y-6 rounded-2xl bg-surface-container-low p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="text-primary text-xl" name="link" />
        </div>
        <div>
          <h3 className="font-bold text-on-surface">{t("inbox.mcp_title")}</h3>
          <p className="text-on-surface-variant text-xs">
            {t("inbox.mcp_desc")}
          </p>
        </div>
      </div>

      {/* Endpoint + config por cliente */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-surface-container-lowest px-3 py-2 font-mono text-sm">
            {MCP_URL}
          </code>
          <CopyButton t={t} text={MCP_URL} />
        </div>
        <div className="flex flex-wrap gap-2">
          {["claude", "chatgpt", "cursor", "ollama"].map((c) => (
            <button
              className={`rounded-full px-4 py-1.5 font-medium text-sm capitalize transition-colors ${
                client === c
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
              key={c}
              onClick={() => setClient(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="relative rounded-xl bg-surface-container-lowest p-4">
          <pre className="overflow-x-auto font-mono text-on-surface-variant text-xs">
            {clientConfig(client)}
          </pre>
          <div className="mt-2">
            <CopyButton t={t} text={clientConfig(client)} />
          </div>
        </div>
      </div>

      {/* Tokens pessoais */}
      <div className="space-y-3">
        <h4 className="font-semibold text-on-surface text-sm">
          {t("inbox.mcp_tokens")}
        </h4>
        {newToken && (
          <div className="rounded-xl border border-success/40 bg-success/10 p-3">
            <p className="font-medium text-on-surface text-xs">
              {t("inbox.mcp_token_once")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-surface-container-lowest px-2 py-1 font-mono text-xs">
                {newToken}
              </code>
              <CopyButton t={t} text={newToken} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            className="flex-1"
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("inbox.mcp_token_label")}
            value={label}
          />
          <button
            className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-on-primary text-sm disabled:opacity-50"
            disabled={busy || !label.trim()}
            onClick={createToken}
            type="button"
          >
            {t("inbox.mcp_token_create")}
          </button>
        </div>
        {tokens.length > 0 && (
          <div className="divide-y divide-outline-variant/40 rounded-xl bg-surface-container-lowest">
            {tokens.map((tok) => (
              <div className="flex items-center gap-3 px-4 py-2.5" key={tok.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {tok.label ?? tok.id}
                  </p>
                  {tok.lastUsedAt && (
                    <p className="text-on-surface-variant text-xs">
                      {t("inbox.mcp_token_last_used")}{" "}
                      {new Date(tok.lastUsedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <button
                  className="flex min-h-9 items-center gap-1 rounded-lg px-3 py-1.5 font-medium text-error text-xs hover:bg-error-container/40"
                  disabled={busy}
                  onClick={() => revokeToken(tok.id)}
                  type="button"
                >
                  {t("inbox.mcp_token_revoke")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Envio direto pelo MCP — off por defeito, aviso de risco */}
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-on-surface text-sm">
              {t("inbox.mcp_direct_send")}
            </p>
            <p className="mt-1 text-on-surface-variant text-xs">
              {t("inbox.mcp_direct_send_warn")}
            </p>
          </div>
          <Switch
            ariaLabel={t("inbox.mcp_direct_send")}
            checked={directSend}
            onChange={saveDirectSend}
          />
        </div>
      </div>

      {/* Retenção */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-on-surface text-sm">
            {t("inbox.retention")}
          </p>
          <p className="text-on-surface-variant text-xs">
            {t("inbox.retention_desc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-24"
            max="3650"
            min="30"
            onChange={(e) => setRetention(e.target.value)}
            type="number"
            value={retention}
          />
          <button
            className="flex min-h-11 items-center rounded-xl bg-surface-container px-4 py-2 font-bold text-on-surface-variant text-sm hover:bg-surface-container-high"
            onClick={saveRetention}
            type="button"
          >
            {t("save")}
          </button>
        </div>
      </div>

      {/* Aviso de privacidade */}
      <p className="rounded-xl bg-surface-container p-3 text-on-surface-variant text-xs">
        {t("inbox.mcp_privacy")}
      </p>
    </div>
  );
}
