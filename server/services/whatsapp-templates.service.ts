import { OutboxStatus, type Prisma } from "@generated/client";
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
const CONDITIONAL_BLOCK_RE = /\{\{if (\w+)\}\}([\s\S]*?)\{\{endif\}\}/g;
const LEFTOVER_MARKER_RE = /\{\{\/?(?:if|endif|else)(?: \w+)?\}\}/g;

/**
 * Vars do corpo por ordem de aparecimento → valores posicionais.
 * Partilhada pelo dispatch (gravação) e pelo outbox (envio) — a ordem
 * tem de bater certo com a do template Meta aprovado.
 */
export function orderedTemplateParams(
  body: string,
  vars: Record<string, string>,
  keep?: Record<string, boolean>
): string[] {
  const order: string[] = [];
  const spec = deriveMetaTemplate("_", expandConditionals(body, keep ?? {}));
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

/** Variáveis de bloco {{if var}} garantidas pela config da loja —
 * shopName existe sempre; trackingUrl/reviewUrl existem quando a loja
 * configurou o portal/reviews. Só estas podem ficar no template Meta. */
export function metaConditionalVars(settings: {
  reviewUrl?: string | null;
  trackingBaseUrl?: string | null;
}): Record<string, boolean> {
  return {
    reviewUrl: Boolean(settings.reviewUrl),
    shopName: true,
    trackingUrl: Boolean(settings.trackingBaseUrl),
  };
}

/** Expande blocos {{if var}}…{{endif}} consoante a config da loja: vars
 * garantidas mantêm o conteúdo (o link de aprovação do orçamento não se
 * perde quando a loja tem tracking público), vars opcionais saem — a
 * Meta não tem condicionais e rejeita parâmetros vazios. Evolution/
 * texto livre continua a renderizar o corpo completo. */
function expandConditionals(
  body: string,
  keep: Record<string, boolean>
): string {
  return body
    .replace(CONDITIONAL_BLOCK_RE, (_m, v: string, inner: string) =>
      keep[v] ? inner : ""
    )
    .replace(LEFTOVER_MARKER_RE, "");
}

interface GraphTemplate {
  components?: { text?: string; type?: string }[];
  id?: string;
  language?: string;
  name?: string;
  rejected_reason?: string;
  status?: string;
}

/** Devolve a entrada na língua alvo — um template com o mesmo nome
 * noutro idioma não conta (existir em `en` não satisfaz `pt_PT`). */
async function graphList(
  wabaId: string,
  token: string,
  name: string
): Promise<GraphTemplate | null | "unreachable"> {
  const res = await fetch(
    `${GRAPH}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,rejected_reason,language,components`,
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
  return body?.data?.find((t) => (t.language ?? "") === TEMPLATE_LANG) ?? null;
}

/** Valores de exemplo exigidos pela Meta para templates com variáveis. */
const EXAMPLE_VALUES: Record<string, string> = {
  currency: "EUR",
  customerName: "Maria Silva",
  deviceLabel: "iPhone 12",
  docLabel: "o termo de reparação",
  jobCode: "REP-2025-000123-AB",
  partName: "ecrã iPhone 12",
  partQuantity: "2",
  partReorderLevel: "3",
  quoteAmount: "45,00",
  requestCode: "PRE-2025-000042",
  reviewUrl: "https://oficinaos.app/r/exemplo",
  shopName: "Oficina Exemplo",
  signUrl: "https://oficinaos.app/s/AbCdEfGh",
  trackingUrl: "https://oficinaos.app/t/AbCdEfGh",
  ttlMinutes: "30",
};

function metaComponents(spec: MetaTemplateSpec) {
  return [
    {
      example:
        spec.vars.length > 0
          ? {
              body_text: [
                spec.vars.map((v) => EXAMPLE_VALUES[v] ?? `exemplo ${v}`),
              ],
            }
          : undefined,
      text: spec.body,
      type: "BODY",
    },
  ];
}

async function graphCreate(
  wabaId: string,
  token: string,
  spec: MetaTemplateSpec
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    body: JSON.stringify({
      allow_category_change: true,
      category: TEMPLATE_CATEGORY,
      components: metaComponents(spec),
      language: TEMPLATE_LANG,
      name: spec.name,
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

/** Edita um template existente (POST /{id}) — volta a revisão. */
async function graphEdit(
  token: string,
  templateId: string,
  spec: MetaTemplateSpec
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/${templateId}`, {
    body: JSON.stringify({
      category: TEMPLATE_CATEGORY,
      components: metaComponents(spec),
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

/** Texto do componente BODY remoto, para comparar com o corpo desejado. */
function remoteBody(t: GraphTemplate | null): string | null {
  return t?.components?.find((c) => c.type === "BODY")?.text?.trim() ?? null;
}

function toStatus(t: GraphTemplate | null): TemplateStatus["status"] {
  const s = (t?.status ?? "PENDING").toUpperCase();
  if (s === "APPROVED" || s === "IN_REVIEW" || s === "REJECTED") {
    return s;
  }
  return "PENDING";
}

/** Lista desejada: todas as WHATSAPP NotificationTemplate da loja. */
async function desiredTemplates(
  prisma: DbClient,
  keep: Record<string, boolean>
): Promise<MetaTemplateSpec[]> {
  const rows = await prisma.notificationTemplate.findMany({
    orderBy: { name: "asc" },
    where: { channel: "WHATSAPP" },
  });
  return rows.map((r) =>
    deriveMetaTemplate(r.name, expandConditionals(r.body, keep))
  );
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
  // Um rename não apaga o modelo antigo na Meta — continua APPROVED lá.
  // As entradas em fila com o nome antigo precisam do seu estado até
  // drenar; sem isto ficavam "unsynced" para sempre e expiravam.
  const pending = await prisma.notificationOutbox.findMany({
    select: { templateName: true },
    where: { channel: "WHATSAPP", status: OutboxStatus.QUEUED },
  });
  const stillNeeded = [
    ...new Set(pending.map((p) => p.templateName).filter((n) => !(n in json))),
  ];
  if (stillNeeded.length > 0) {
    const prev = (
      await prisma.shopSettings.findUnique({
        select: { whatsappTemplatesJson: true },
        where: { id: "default" },
      })
    )?.whatsappTemplatesJson;
    if (prev && typeof prev === "object") {
      for (const name of stillNeeded) {
        const kept = (prev as Record<string, Prisma.InputJsonValue>)[name];
        if (kept) {
          json[name] = kept;
        }
      }
    }
  }
  await prisma.shopSettings.update({
    data: { whatsappTemplatesJson: json },
    where: { id: "default" },
  });
}

/**
 * Sync direto à Meta — grátis/local. Lê primeiro, cria o que falta.
 * Um WABA/token em falta devolve erro em vez de falhar silenciosamente.
 * `lookupNames` = nomes só para LEITURA (templates renomeados mas ainda
 * em fila) — refresh do estado real sem recriar/editar nada na Meta.
 */
async function syncLocal(
  desired: MetaTemplateSpec[],
  wabaId: string,
  token: string,
  lookupNames: string[] = []
): Promise<TemplateStatus[]> {
  const out: TemplateStatus[] = [];
  for (const t of desired) {
    if (!META_NAME_RE.test(t.name)) {
      out.push({
        name: t.name,
        // Códigos estáveis — a UI traduz (i18n); a razão da Meta
        // (rejected_reason) chega verbatim e exibe-se crua.
        reason: "INVALID_NAME",
        status: "REJECTED",
      });
      continue;
    }
    let existing = await graphList(wabaId, token, t.name);
    if (existing === null) {
      await graphCreate(wabaId, token, t);
      existing = await graphList(wabaId, token, t.name);
    } else if (
      existing !== "unreachable" &&
      remoteBody(existing) !== null &&
      remoteBody(existing) !== t.body.trim()
    ) {
      // Corpo local editado (editor de templates) → submete a nova
      // versão para revisão; manter a antiga enviava params na ordem
      // nova contra texto velho.
      await graphEdit(token, existing.id ?? "", t);
      existing = await graphList(wabaId, token, t.name);
    }
    if (existing === "unreachable") {
      out.push({
        name: t.name,
        reason: "GRAPH_UNREACHABLE",
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
  out.push(...(await lookupRenamedStatuses(wabaId, token, lookupNames)));
  return out;
}

/**
 * Nomes renomeados mas ainda em fila: a Meta pode suspendê-los e o
 * estado preservado ficava eternamente APPROVED — leitura só, nunca
 * cria/edita.
 */
async function lookupRenamedStatuses(
  wabaId: string,
  token: string,
  names: string[]
): Promise<TemplateStatus[]> {
  const out: TemplateStatus[] = [];
  for (const name of names) {
    const existing = await graphList(wabaId, token, name);
    // Falha de consulta ≠ ausência confirmada — sem entrada no
    // resultado, o persistStatuses preserva o estado anterior em vez
    // de gravar MISSING e adiar a fila 30min por causa de um timeout.
    if (existing === "unreachable") {
      continue;
    }
    out.push({
      name,
      reason: existing?.rejected_reason ?? undefined,
      status: existing === null ? "MISSING" : toStatus(existing),
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
  const desired = await desiredTemplates(prisma, metaConditionalVars(settings));
  // O total/ready mede os modelos ATUAIS — os lookups de nomes
  // renomeados entram em `statuses` só para a fila drenar, e contá-los
  // mostrava «3 de 2 modelos aprovados» no aviso de sync.
  const desiredNames = new Set(desired.map((d) => d.name));
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
    // Nomes que já não existem localmente mas têm entradas em fila —
    // leitura-only à Meta para o estado preservado não congelar se a
    // Meta suspender/rejeitar o modelo antigo.
    const queued = await prisma.notificationOutbox.findMany({
      select: { templateName: true },
      where: { channel: "WHATSAPP", status: OutboxStatus.QUEUED },
    });
    const lookupNames = [
      ...new Set(
        queued.map((q) => q.templateName).filter((n) => !desiredNames.has(n))
      ),
    ];
    statuses = await syncLocal(desired, wabaId, token, lookupNames);
  } else {
    // Evolution ou WhatsApp desligado — não há templates Meta a sincronizar.
    return { ready: 0, templates: [], total: desired.length };
  }

  await persistStatuses(prisma, statuses).catch((err) =>
    log?.warn({ err }, "whatsapp-templates: persistência do estado falhou")
  );
  const ready = statuses.filter(
    (s) => s.status === "APPROVED" && desiredNames.has(s.name)
  ).length;
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
