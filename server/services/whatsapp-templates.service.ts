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
// Corpo submetido à Meta (posicional {{n}}): não pode começar nem acabar
// num parâmetro — a Graph rejeita a submissão antes da revisão.
const EDGE_POSITIONAL_RE = /^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/;

/** true quando o corpo posicional pode ser submetido à Meta. */
export function isMetaBodySubmittable(body: string): boolean {
  return !EDGE_POSITIONAL_RE.test(body);
}

/**
 * A Meta rejeita corpos que terminam num parâmetro. Um bloco condicional
 * cujo conteúdo fecha numa variável torna-se terminal quando é o último
 * ou é seguido apenas por outro bloco {{if}} (que pode expandir para
 * vazio) — por isso a variável recebe um "." literal, garantindo texto
 * depois do parâmetro. Espelha a migração 20261228000000 (Postgres).
 */
export function metaSafeConditionals(body: string): string {
  return body.replace(
    /(\{\{\w+\}\})(\{\{endif\}\})(?=\s*(?:\{\{if|$))/g,
    "$1.$2"
  );
}

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
  /** Corpo com variáveis posicionais {{1}}…{{n}} — o que se submete à Meta. */
  body: string;
  name: string;
  /** Corpo expandido com {{var}} nomeadas — ordena os params do envio. */
  namedBody: string;
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
  return { body: meta, name, namedBody: body, vars };
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
export function expandConditionals(
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
  return rows.map((r) => {
    const namedBody = expandConditionals(r.body, keep);
    return { ...deriveMetaTemplate(r.name, namedBody), namedBody };
  });
}

interface PersistedTemplateStatus {
  /** Corpo nomeado ({{var}}) da versão que a aprovação cobre — ver nota. */
  body?: string;
  reason?: string;
  status?: string;
  syncedAt?: string;
}

/** Estado conhecido do template no último sync — null = sem registo. */
export function templateStatusOf(
  settings: { whatsappTemplatesJson?: unknown } | null,
  name: string
): string | null {
  const raw = settings?.whatsappTemplatesJson;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = (raw as Record<string, PersistedTemplateStatus>)[name];
  const s = typeof entry?.status === "string" ? entry.status : null;
  return s ? s.toUpperCase() : null;
}

/**
 * Corpo (vars nomeadas) que a aprovação Meta cobre. A Cloud só CRIA
 * modelos — nunca edita um existente —, por isso a versão aprovada é
 * sempre a da primeira submissão do nome, mesmo que a loja tenha
 * editado o corpo local depois. O outbox ordena os parâmetros por esta
 * versão; sem ela uma edição trocava a ordem posicional (campos trocados
 * ou rejeição na entrega).
 */
export function approvedTemplateBodyOf(
  settings: { whatsappTemplatesJson?: unknown } | null,
  name: string
): string | null {
  const raw = settings?.whatsappTemplatesJson;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const body = (raw as Record<string, PersistedTemplateStatus>)[name]?.body;
  return typeof body === "string" && body.length > 0 ? body : null;
}

async function persistStatuses(
  prisma: DbClient,
  statuses: TemplateStatus[],
  desired: MetaTemplateSpec[]
): Promise<void> {
  const prev = (
    await prisma.shopSettings.findUnique({
      select: { whatsappTemplatesJson: true },
      where: { id: "default" },
    })
  )?.whatsappTemplatesJson;
  const prevMap =
    prev && typeof prev === "object"
      ? (prev as Record<string, PersistedTemplateStatus>)
      : {};
  const namedBodyOf = new Map(desired.map((d) => [d.name, d.namedBody]));
  const json: Record<string, Prisma.InputJsonValue> = {};
  for (const s of statuses) {
    // A aprovação fica ligada à versão do corpo: grava-se o corpo da
    // primeira submissão e mantém-se — a Cloud nunca reescreve um modelo
    // existente, por isso a versão que a Meta tem aprovada não muda com
    // edições locais posteriores.
    const approvedBody = prevMap[s.name]?.body ?? namedBodyOf.get(s.name);
    json[s.name] = {
      body: approvedBody ?? null,
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
  for (const name of stillNeeded) {
    const kept = prevMap[name];
    if (kept) {
      json[name] = kept as unknown as Prisma.InputJsonValue;
    }
  }
  await prisma.shopSettings.update({
    data: { whatsappTemplatesJson: json },
    where: { id: "default" },
  });
}

/**
 * Depois de um sync persistir estados: entradas adiadas à espera de
 * aprovação voltam já à fila quando o seu template ficou APPROVED —
 * o deliverBy (ex.: sessão de assinatura) não pode esperar os 30 min
 * do re-agendamento normal. Corre em TODOS os caminhos que persistem
 * uma aprovação (sync automático do outbox, re-sync das definições e o
 * botão manual), porque é chamado dentro de syncWhatsAppTemplates.
 */
export async function expediteApprovedDeferred(
  prisma: DbClient,
  settings?: { whatsappTemplatesJson?: unknown } | null
): Promise<void> {
  const row =
    settings ??
    (await prisma.shopSettings.findUnique({
      select: { whatsappTemplatesJson: true },
      where: { id: "default" },
    }));
  const deferred = await prisma.notificationOutbox.findMany({
    select: { id: true, templateName: true },
    where: {
      channel: "WHATSAPP",
      error: { startsWith: "Template " },
      status: OutboxStatus.QUEUED,
    },
  });
  const ready = deferred.filter(
    (e) => templateStatusOf(row, e.templateName) === "APPROVED"
  );
  if (ready.length > 0) {
    await prisma.notificationOutbox.updateMany({
      data: { nextRetryAt: new Date() },
      where: { id: { in: ready.map((e) => e.id) } },
    });
  }
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
  // Validação pré-submissão: a Meta rejeita corpos a começar/acabar num
  // parâmetro. Um corpo inválido (ex.: edição da loja) não se submete —
  // marca-se REJECTED com razão estável para a UI explicar, e a fila
  // adia como qualquer modelo não-aprovado.
  const submittable: MetaTemplateSpec[] = [];
  const invalidStatuses: TemplateStatus[] = [];
  for (const d of desired) {
    if (isMetaBodySubmittable(d.body)) {
      submittable.push(d);
    } else {
      invalidStatuses.push({
        name: d.name,
        reason: "INVALID_BODY_EDGES",
        status: "REJECTED",
      });
    }
  }
  const channel = resolveWhatsAppChannel(settings);
  if (channel?.mode !== "cloud") {
    // Grátis/local e Evolution: a app não gere templates na Meta —
    // envia pelo nome e a Meta rejeita o que faltar (erro de envio normal).
    return {
      ready: 0,
      templates: invalidStatuses,
      total: desired.length,
    };
  }
  const res = await syncCloud(
    submittable,
    settings.whatsappBusinessId ?? "",
    channel.apiUrl,
    channel.shopToken
  );
  if ("error" in res) {
    return {
      error: res.error,
      ready: 0,
      templates: invalidStatuses,
      total: desired.length,
    };
  }
  const statuses = [...res, ...invalidStatuses];

  await persistStatuses(prisma, statuses, desired).catch((err) =>
    log?.warn({ err }, "whatsapp-templates: persistência do estado falhou")
  );
  // Toda a persistência de aprovações antecipa a fila (sync manual nas
  // definições incluído): um link de assinatura que esperava revisão da
  // Meta sai dentro do prazo em vez de expirar adiado 30 min. Lê o JSON
  // fresco — o `settings` desta função é pré-sync e não tem os estados
  // que persistStatuses acabou de gravar.
  await expediteApprovedDeferred(prisma).catch((err) =>
    log?.warn({ err }, "whatsapp-templates: expedite da fila falhou")
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
    // Corpo local não-submissível (edição da loja a começar/acabar num
    // parâmetro): mostra-se já como rejeitado — a Meta recusava-o com
    // a mesma certeza, e o aviso aponta a causa sem esperar um sync.
    const invalid = !isMetaBodySubmittable(d.body);
    return {
      body: d.body,
      category: TEMPLATE_CATEGORY,
      language: TEMPLATE_LANG,
      name: d.name,
      reason: invalid ? "INVALID_BODY_EDGES" : (v?.reason ?? undefined),
      status: (invalid
        ? "REJECTED"
        : (v?.status?.toUpperCase() ?? "MISSING")) as TemplateStatus["status"],
      syncedAt: v?.syncedAt,
    };
  });
}
