import type { Prisma } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { cloudFetch } from "./cloud.service.js";
import { resolveWhatsAppChannel } from "./whatsapp-channel.js";

/**
 * §5.6 C.2 — sync automático de templates Meta.
 *
 * Fonte de verdade: as NotificationTemplate WHATSAPP da loja (mesmos
 * textos que o outbox renderiza). Cada {{var}} torna-se um parâmetro
 * posicional {{n}} na ordem de aparecimento — a mesma ordem em que o
 * dispatch grava templateParams, para o template aprovado bater certo
 * com o envio. Categoria UTILITY, língua pt_PT.
 *
 * Grátis/local: a app fala direto à Graph API com o token da loja.
 * Pro/cloud: a Cloud fala à Graph com a credencial migrada (a app só
 * envia a lista desejada + wabaId).
 *
 * Idempotente: GET primeiro, só cria o que falta. Corre ao ligar o
 * WhatsApp e pelo botão "Voltar a submeter".
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const GRAPH_TIMEOUT_MS = 15_000;
export const TEMPLATE_LANG = "pt_PT";
const TEMPLATE_CATEGORY = "UTILITY";
const META_NAME_RE = /^[a-z0-9_]+$/;
const VAR_RE = /\{\{(\w+)\}\}/g;

/**
 * Vars do corpo por ordem de aparecimento → valores posicionais.
 * Partilhada pelo dispatch (gravação) e pelo outbox (envio) — a ordem
 * tem de bater certo com a do template Meta aprovado.
 */
export function orderedTemplateParams(
  body: string,
  vars: Record<string, string>
): string[] {
  const order: string[] = [];
  const spec = deriveMetaTemplate("_", stripConditionals(body));
  for (const v of spec.vars) {
    order.push(vars[v] ?? "");
  }
  return order;
}

export interface MetaTemplateSpec {
  /** Corpo com variáveis posicionais {{1}}…{{n}}. */
  body: string;
  name: string;
  /** Variáveis na ordem de aparecimento — ordem dos params do envio. */
  vars: string[];
}

export interface TemplateStatus {
  name: string;
  reason?: string;
  status: "APPROVED" | "IN_REVIEW" | "REJECTED" | "PENDING" | "MISSING";
  syncedAt?: string;
}

export interface TemplateSyncResult {
  error?: string;
  ready: number;
  templates: TemplateStatus[];
  total: number;
}

/** NotificationTemplate.body → spec Meta. Vars por ordem de aparecimento. */
export function deriveMetaTemplate(
  name: string,
  body: string
): MetaTemplateSpec {
  const vars: string[] = [];
  const meta = body.replace(VAR_RE, (_m, v: string) => {
    let idx = vars.indexOf(v);
    if (idx === -1) {
      vars.push(v);
      idx = vars.length - 1;
    }
    return `{{${idx + 1}}}`;
  });
  return { body: meta, name, vars };
}

/** Remove a marcação {{if var}}…{{/if}} que a Meta não entende — condicionais ficam literalmente vazias. */
function stripConditionals(body: string): string {
  return body
    .replace(/\{\{if \w+\}\}/g, "")
    .replace(/\{\{\/if\}\}/g, "")
    .replace(/\{\{#if \w+\}\}/g, "");
}

interface GraphTemplate {
  name?: string;
  rejected_reason?: string;
  status?: string;
}

async function graphList(
  wabaId: string,
  token: string,
  name: string
): Promise<GraphTemplate | null | "unreachable"> {
  const res = await fetch(
    `${GRAPH}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,rejected_reason`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    }
  ).catch(() => null);
  if (!res?.ok) {
    return "unreachable";
  }
  const body = (await res.json().catch(() => null)) as {
    data?: GraphTemplate[];
  } | null;
  return body?.data?.[0] ?? null;
}

async function graphCreate(
  wabaId: string,
  token: string,
  name: string,
  body: string
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    body: JSON.stringify({
      allow_category_change: true,
      category: TEMPLATE_CATEGORY,
      components: [{ text: body, type: "BODY" }],
      language: TEMPLATE_LANG,
      name,
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  }).catch(() => null);
  return res?.ok === true;
}

function toStatus(t: GraphTemplate | null): TemplateStatus["status"] {
  const s = (t?.status ?? "PENDING").toUpperCase();
  if (s === "APPROVED" || s === "IN_REVIEW" || s === "REJECTED") {
    return s;
  }
  return "PENDING";
}

/** Lista desejada: todas as WHATSAPP NotificationTemplate da loja. */
async function desiredTemplates(prisma: DbClient): Promise<MetaTemplateSpec[]> {
  const rows = await prisma.notificationTemplate.findMany({
    orderBy: { name: "asc" },
    where: { channel: "WHATSAPP" },
  });
  return rows.map((r) => deriveMetaTemplate(r.name, stripConditionals(r.body)));
}

async function persistStatuses(
  prisma: DbClient,
  statuses: TemplateStatus[]
): Promise<void> {
  const json: Record<string, Prisma.InputJsonValue> = {};
  for (const s of statuses) {
    json[s.name] = {
      reason: s.reason ?? null,
      status: s.status,
      syncedAt: s.syncedAt ?? new Date().toISOString(),
    };
  }
  await prisma.shopSettings.update({
    data: { whatsappTemplatesJson: json },
    where: { id: "default" },
  });
}

/**
 * Sync direto à Meta — grátis/local. Lê primeiro, cria o que falta.
 * Um WABA/token em falta devolve erro em vez de falhar silenciosamente.
 */
async function syncLocal(
  desired: MetaTemplateSpec[],
  wabaId: string,
  token: string
): Promise<TemplateStatus[]> {
  const out: TemplateStatus[] = [];
  for (const t of desired) {
    if (!META_NAME_RE.test(t.name)) {
      out.push({
        name: t.name,
        reason: "nome inválido p/ Meta",
        status: "REJECTED",
      });
      continue;
    }
    let existing = await graphList(wabaId, token, t.name);
    if (existing === null) {
      await graphCreate(wabaId, token, t.name, t.body);
      existing = await graphList(wabaId, token, t.name);
    }
    if (existing === "unreachable") {
      out.push({
        name: t.name,
        reason: "Graph API inacessível",
        status: "MISSING",
      });
      continue;
    }
    const status = toStatus(existing);
    out.push({
      name: t.name,
      reason: existing?.rejected_reason ?? undefined,
      status: existing === null ? "MISSING" : status,
    });
  }
  return out;
}

interface CloudSyncItem {
  name?: string;
  reason?: string;
  status?: string;
}

/** Sync pela Cloud — Pro. A app envia a lista; a Cloud fala à Meta. */
async function syncCloud(
  desired: MetaTemplateSpec[],
  wabaId: string,
  apiUrl: string,
  token: string
): Promise<TemplateStatus[] | { error: string }> {
  const res = await cloudFetch(apiUrl, "/whatsapp/templates/sync", {
    body: {
      templates: desired.map((t) => ({ body: t.body, name: t.name })),
      wabaId,
    },
    method: "POST",
    timeoutMs: 30_000,
    token,
  }).catch(() => null);
  if (!res?.ok || typeof res.body !== "object" || res.body === null) {
    return { error: `Cloud devolveu ${res?.status ?? "sem resposta"}` };
  }
  const items = (res.body as { templates?: CloudSyncItem[] }).templates ?? [];
  return desired.map((d) => {
    const item = items.find((i) => i.name === d.name);
    return {
      name: d.name,
      reason: item?.reason ?? undefined,
      status: (item?.status?.toUpperCase() ??
        "MISSING") as TemplateStatus["status"],
    };
  });
}

/**
 * Ponto de entrada — corre ao ligar o WhatsApp e pelo botão de resubmit.
 * Resolve o modo (local/cloud/evolution) e persiste o estado por template.
 */
export async function syncWhatsAppTemplates(
  prisma: DbClient,
  log?: FastifyBaseLogger
): Promise<TemplateSyncResult> {
  const settings = await getOrCreateShopSettings(prisma);
  const desired = await desiredTemplates(prisma);
  if (desired.length === 0) {
    return { ready: 0, templates: [], total: 0 };
  }
  const channel = resolveWhatsAppChannel(settings);
  const wabaId = settings.whatsappBusinessId ?? "";

  let statuses: TemplateStatus[];
  if (channel?.mode === "cloud") {
    const res = await syncCloud(
      desired,
      wabaId,
      channel.apiUrl,
      channel.shopToken
    );
    if ("error" in res) {
      return {
        error: res.error,
        ready: 0,
        templates: [],
        total: desired.length,
      };
    }
    statuses = res;
  } else if (channel?.mode === "local") {
    const token = settings.whatsappApiTokenEncrypted
      ? decryptSecret(settings.whatsappApiTokenEncrypted)
      : null;
    if (!(wabaId && token)) {
      return {
        error: "WhatsApp por configurar (business ID ou token em falta)",
        ready: 0,
        templates: [],
        total: desired.length,
      };
    }
    statuses = await syncLocal(desired, wabaId, token);
  } else {
    // Evolution ou WhatsApp desligado — não há templates Meta a sincronizar.
    return { ready: 0, templates: [], total: desired.length };
  }

  await persistStatuses(prisma, statuses).catch((err) =>
    log?.warn({ err }, "whatsapp-templates: persistência do estado falhou")
  );
  const ready = statuses.filter((s) => s.status === "APPROVED").length;
  return { ready, templates: statuses, total: desired.length };
}

/** Estado persistido para a UI (sem nova chamada à Meta/Cloud). */
export async function getWhatsAppTemplateStatuses(
  prisma: DbClient
): Promise<TemplateStatus[]> {
  const settings = await getOrCreateShopSettings(prisma);
  const raw = settings.whatsappTemplatesJson;
  if (!raw || typeof raw !== "object") {
    return [];
  }
  return Object.entries(
    raw as Record<
      string,
      { reason?: string; status?: string; syncedAt?: string }
    >
  ).map(([name, v]) => ({
    name,
    reason: v?.reason ?? undefined,
    status: (v?.status?.toUpperCase() ?? "PENDING") as TemplateStatus["status"],
    syncedAt: v?.syncedAt,
  }));
}
