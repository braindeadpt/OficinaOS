import { OutboxStatus, type Prisma } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
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
 * Pro/cloud apenas: a Cloud fala à Graph com a credencial migrada (a
 * app só envia a lista desejada + wabaId). Grátis = SÓ ENVIO: a app não
 * gere templates na Meta — a loja cria-os à mão no Business Manager e
 * o envio local usa-os pelo nome; se faltar/aprovar, a Meta rejeita o
 * envio e a entrada falha como erro normal.
 *
 * Idempotente (cloud): a Cloud lê primeiro, só cria o que falta.
 */

export const TEMPLATE_LANG = "pt_PT";
const TEMPLATE_CATEGORY = "UTILITY";
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
 * Só faz alguma coisa em modo Pro/cloud (decisão 2026-11-23: sem o
 * módulo "whatsapp-bot" o resolve devolve null — e no modo local/Evolution
 * a gestão Meta continua fora da app: envia pelo nome e a Meta rejeita
 * o que faltar como erro de envio normal).
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
  if (channel?.mode !== "cloud") {
    // Grátis/local e Evolution: a app não gere templates na Meta —
    // envia pelo nome e a Meta rejeita o que faltar (erro de envio normal).
    return { ready: 0, templates: [], total: desired.length };
  }
  const res = await syncCloud(
    desired,
    settings.whatsappBusinessId ?? "",
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
  const statuses = res;

  await persistStatuses(prisma, statuses).catch((err) =>
    log?.warn({ err }, "whatsapp-templates: persistência do estado falhou")
  );
  const ready = statuses.filter(
    (s) => s.status === "APPROVED" && desiredNames.has(s.name)
  ).length;
  return { ready, templates: statuses, total: desired.length };
}

/** Template para a UI: spec Meta (nome/corpo/categoria/língua — serve
 * a criação manual no modo local Pro, que não gere templates na Meta) +
 * estado persistido do último sync cloud quando existir. Sem chamadas
 * à Meta/Cloud. */
export interface WhatsAppTemplateInfo extends TemplateStatus {
  body: string;
  category: string;
  language: string;
}

export async function getWhatsAppTemplateStatuses(
  prisma: DbClient
): Promise<WhatsAppTemplateInfo[]> {
  const settings = await getOrCreateShopSettings(prisma);
  const desired = await desiredTemplates(prisma, metaConditionalVars(settings));
  const raw = settings.whatsappTemplatesJson;
  const persisted =
    raw && typeof raw === "object"
      ? (raw as Record<
          string,
          { reason?: string; status?: string; syncedAt?: string }
        >)
      : {};
  return desired.map((d) => {
    const v = persisted[d.name];
    return {
      body: d.body,
      category: TEMPLATE_CATEGORY,
      language: TEMPLATE_LANG,
      name: d.name,
      reason: v?.reason ?? undefined,
      status: (v?.status?.toUpperCase() ??
        "MISSING") as TemplateStatus["status"],
      syncedAt: v?.syncedAt,
    };
  });
}
