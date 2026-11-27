import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import api, { getErrorMessage } from "@/lib/api";

/**
 * Vista de administração dos tokens MCP (decisão do mentor): em
 * Definições → IA o dono vê os tokens de TODOS os utilizadores e pode
 * revogá-los. A criação é self-service no perfil de cada utilizador.
 */

interface AdminMcpToken {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastUsedAt: string | null;
  name: string;
  prefix: string;
  revoked: boolean;
  showPii: boolean;
  userName?: string;
  userUsername?: string;
}

function adminStatusText(tok: AdminMcpToken, t: (k: string) => string): string {
  if (tok.revoked) {
    return t("mcp.revoked");
  }
  if (tok.lastUsedAt) {
    return `${t("mcp.last_used")}: ${new Date(tok.lastUsedAt).toLocaleString()}`;
  }
  return t("mcp.never_used");
}

export default function SettingsMcpAdminSection() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<AdminMcpToken[]>([]);
  const [busy, setBusy] = useState(false);

  const loadTokens = useCallback(async () => {
    try {
      const res = await api.get("/mcp/tokens/all");
      const list = (res.data ?? []) as AdminMcpToken[];
      setTokens(Array.isArray(list) ? list : []);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    loadTokens().catch(() => undefined);
  }, [loadTokens]);

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
    <div className="space-y-4 rounded-2xl bg-surface-container-low p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="text-primary text-xl" name="admin_panel_settings" />
        </div>
        <div>
          <h3 className="font-bold text-on-surface">{t("mcp.admin_title")}</h3>
          <p className="text-on-surface-variant text-sm">
            {t("mcp.admin_subtitle")}
          </p>
        </div>
      </div>

      {tokens.length === 0 && (
        <p className="text-on-surface-variant text-sm">{t("mcp.no_tokens")}</p>
      )}

      {tokens.map((tok) => (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container px-4 py-3"
          key={tok.id}
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium text-on-surface text-sm">
              {tok.userName ?? tok.userUsername ?? "—"}
              {tok.userName && tok.userUsername
                ? ` (@${tok.userUsername})`
                : ""}{" "}
              · {tok.name}{" "}
              <span className="font-mono text-on-surface-variant text-xs">
                {tok.prefix}…
              </span>
            </p>
            <p className="text-on-surface-variant text-xs">
              {adminStatusText(tok, t)}
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
  );
}
