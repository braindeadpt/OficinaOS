import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import api, { getErrorMessage } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";

/**
 * «Ligar o seu LLM» — MCP grátis SÓ DE LEITURA (issue #74). Tokens pessoais
 * oos_* que herdam as permissões do utilizador, servidor MCP só em loopback
 * (127.0.0.1) e stdio. Sem qualquer dependência da Cloud — ao contrário da
 * secção «Ligar a outra IA» da caixa de entrada, que é Pro.
 */

interface LocalMcpToken {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  prefix: string;
  revoked: boolean;
  showPii: boolean;
  token?: string; // só no create — mostrado uma única vez
}

function clientConfig(client: string): string {
  const stdio = {
    command: "bunx",
    args: ["oficinaos-mcp", "--token", "<TOKEN>"],
  };
  switch (client) {
    case "claude":
      return JSON.stringify({ mcpServers: { oficinaos: stdio } }, null, 2);
    case "cursor":
      return JSON.stringify({ mcpServers: { oficinaos: stdio } }, null, 2);
    case "lmstudio":
      return JSON.stringify(
        {
          mcpServers: {
            oficinaos: {
              headers: { Authorization: "Bearer <TOKEN>" },
              url: "http://127.0.0.1:4100/mcp",
            },
          },
        },
        null,
        2
      );
    default:
      return JSON.stringify({ mcpServers: { oficinaos: stdio } }, null, 2);
  }
}

function CopyButton({ text, t }: { text: string; t: (k: string) => string }) {
  return (
    <button
      className="flex min-h-9 items-center gap-1.5 rounded-lg bg-surface-container px-3 py-1.5 font-medium text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high"
      onClick={() => {
        copyTextToClipboard(text).then((ok) => {
          if (ok) {
            toast.success(t("mcp.copied"));
          } else {
            toast.error(t("mcp.action_error"));
          }
        });
      }}
      type="button"
    >
      <Icon name="content_copy" size="sm" />
      {t("mcp.copy")}
    </button>
  );
}

const CLIENT_LABELS: Record<string, string> = {
  claude: "Claude Desktop",
  cursor: "Cursor",
  lmstudio: "LM Studio",
};

function tokenStatusText(tok: LocalMcpToken, t: (k: string) => string): string {
  if (tok.revoked) {
    return t("mcp.revoked");
  }
  if (tok.lastUsedAt) {
    return `${t("mcp.last_used")}: ${new Date(tok.lastUsedAt).toLocaleString()}`;
  }
  return t("mcp.never_used");
}

export default function SettingsMcpLocalSection() {
  const { t } = useTranslation();

  const [tokens, setTokens] = useState<LocalMcpToken[]>([]);
  const [name, setName] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [showPii, setShowPii] = useState(false);
  const [piiAck, setPiiAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState("claude");
  const [newToken, setNewToken] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    try {
      const res = await api.get("/mcp/tokens");
      const list = (res.data ?? []) as LocalMcpToken[];
      setTokens(Array.isArray(list) ? list : []);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    loadTokens().catch(() => undefined);
  }, [loadTokens]);

  async function createToken() {
    if (!name.trim()) {
      return;
    }
    if (showPii && !piiAck) {
      toast.error(t("mcp.pii_ack_required"));
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), showPii };
      if (expiresAt) {
        body.expiresAt = new Date(expiresAt).toISOString();
      }
      const res = await api.post("/mcp/tokens", body);
      const tok = res.data?.token ?? null;
      setNewToken(typeof tok === "string" ? tok : null);
      setName("");
      setExpiresAt("");
      setShowPii(false);
      setPiiAck(false);
      await loadTokens();
    } catch (err) {
      toast.error(getErrorMessage(err, t("mcp.action_error")));
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string) {
    setBusy(true);
    try {
      await api.delete(`/mcp/tokens/${id}`);
      await loadTokens();
    } catch (err) {
      toast.error(getErrorMessage(err, t("mcp.action_error")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 rounded-2xl bg-surface-container-low p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="text-primary text-xl" name="terminal" />
        </div>
        <div>
          <h3 className="font-bold text-on-surface">{t("mcp.title")}</h3>
          <p className="text-on-surface-variant text-sm">{t("mcp.subtitle")}</p>
        </div>
      </div>

      <p className="text-on-surface-variant text-sm">
        {t("mcp.readonly_note")}
      </p>

      {/* Criar token */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Field id="mcp-token-name" label={t("mcp.name_label")}>
              <Input
                onChange={(e) => setName(e.target.value)}
                placeholder={t("mcp.name_placeholder")}
                value={name}
              />
            </Field>
          </div>
          <div>
            <Field id="mcp-token-expiry" label={t("mcp.expiry_label")}>
              <Input
                onChange={(e) => setExpiresAt(e.target.value)}
                type="date"
                value={expiresAt}
              />
            </Field>
          </div>
          <button
            className="flex min-h-10 items-center gap-2 rounded-xl bg-primary px-4 py-2 font-medium text-on-primary text-sm transition-opacity disabled:opacity-50"
            disabled={busy || !name.trim()}
            onClick={createToken}
            type="button"
          >
            <Icon name="add" size="sm" />
            {t("mcp.create")}
          </button>
        </div>

        <Field horizontal label={t("mcp.show_pii_label")}>
          <Checkbox
            checked={showPii}
            onChange={(e) => setShowPii(e.target.checked)}
          />
        </Field>
        {showPii && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-on-surface text-sm">
            <p className="font-medium">{t("mcp.pii_warning_title")}</p>
            <p className="mt-1 text-on-surface-variant">
              {t("mcp.pii_warning_body")}
            </p>
            <div className="mt-2">
              <Field horizontal label={t("mcp.pii_ack_label")}>
                <Checkbox
                  checked={piiAck}
                  onChange={(e) => setPiiAck(e.target.checked)}
                />
              </Field>
            </div>
          </div>
        )}
      </div>

      {/* Token novo — mostrado uma única vez */}
      {newToken && (
        <div className="space-y-2 rounded-xl border border-success/40 bg-success/10 p-4">
          <p className="font-medium text-on-surface text-sm">
            {t("mcp.token_once")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-surface-container px-3 py-2 font-mono text-on-surface text-sm">
              {newToken}
            </code>
            <CopyButton t={t} text={newToken} />
          </div>
        </div>
      )}

      {/* Lista de tokens */}
      {tokens.length > 0 && (
        <div className="space-y-2">
          {tokens.map((tok) => (
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container px-4 py-3"
              key={tok.id}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-on-surface text-sm">
                  {tok.name}{" "}
                  <span className="font-mono text-on-surface-variant text-xs">
                    {tok.prefix}…
                  </span>
                </p>
                <p className="text-on-surface-variant text-xs">
                  {tokenStatusText(tok, t)}
                  {tok.expiresAt
                    ? ` · ${t("mcp.expires")}: ${new Date(tok.expiresAt).toLocaleDateString()}`
                    : ""}
                  {tok.showPii ? ` · ${t("mcp.pii_badge")}` : ""}
                </p>
              </div>
              {!tok.revoked && (
                <button
                  className="flex min-h-9 items-center gap-1.5 rounded-lg bg-error/10 px-3 py-1.5 font-medium text-error text-xs transition-colors hover:bg-error/20 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => revokeToken(tok.id)}
                  type="button"
                >
                  <Icon name="block" size="sm" />
                  {t("mcp.revoke")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Configuração pronta a copiar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {(["claude", "cursor", "lmstudio"] as const).map((c) => (
            <button
              className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-colors ${
                client === c
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
              key={c}
              onClick={() => setClient(c)}
              type="button"
            >
              {CLIENT_LABELS[c]}
            </button>
          ))}
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded-xl bg-surface-container p-4 font-mono text-on-surface text-xs">
            {clientConfig(client)}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton t={t} text={clientConfig(client)} />
          </div>
        </div>
        <p className="text-on-surface-variant text-xs">
          {t("mcp.config_hint")}
        </p>
      </div>
    </div>
  );
}
