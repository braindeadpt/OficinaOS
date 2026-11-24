import {
  COUNTRY_DIAL_CODES,
  NATIONAL_NUMBER_LENGTHS,
} from "@shared/constants/countries.js";
import type { DbClient } from "../repositories/types.js";
import { findCustomersByPhone } from "./bot-intents.js";

/** Logger mínimo — fastify request log e o pino partilhado servem. */
export interface InboxLogger {
  info: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
}

/**
 * Caixa de entrada unificada (§G, módulo Pro "ai-inbox").
 *
 * Cada conversa corresponde a um par (canal + telefone do cliente):
 * conversationKey = "<canal>:<telefone normalizado>". As mensagens
 * individuais vivem em BusinessMessage — o registo manual continua a
 * servir documentos internos; as mensagens dos canais WhatsApp/SMS/
 * Evolution passam todas por aqui para a inbox mostrar tudo.
 *
 * O estado mutável da conversa (status, atribuição, escalada, não-lidas)
 * fica em InboxConversation — nunca espalhado pelas mensagens.
 *
 * A gravação é gated no chamador por isModuleEnabled(settings,
 * "ai-inbox"): o módulo Pro é o entitlement Cloud, não uma flag local.
 */

export const INBOX_CHANNEL_WHATSAPP = "whatsapp";
export const INBOX_CHANNEL_EVOLUTION = "evolution";
export const INBOX_CHANNEL_SMS = "sms";

export const INBOX_HANDLED_BOT = "BOT";
export const INBOX_HANDLED_STAFF = "STAFF";
export const INBOX_HANDLED_SYSTEM = "SYSTEM";

export const INBOX_STATUS_OPEN = "OPEN";
export const INBOX_STATUS_PENDING = "PENDING";
export const INBOX_STATUS_CLOSED = "CLOSED";

const CHANNEL_SUBJECT: Record<string, string> = {
  evolution: "WhatsApp (Evolution)",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

/**
 * Dígitos no formato internacional (sem "+" nem "00"), com o indicativo
 * do país da loja quando o número chega local. Regra única partilhada
 * pela chave de conversa e pelo phone guardado — assim o reply staff
 * pode fazer prepend de "+" sem partir números locais.
 */
export function internationalPhoneDigits(
  phone: string,
  countryCode = "PT"
): string {
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  const international = trimmed.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (!international) {
    const nationalLen = NATIONAL_NUMBER_LENGTHS[countryCode] ?? 15;
    if (digits.length <= nationalLen) {
      digits = `${COUNTRY_DIAL_CODES[countryCode] ?? COUNTRY_DIAL_CODES.PT}${digits}`;
    }
  }
  return digits;
}

export function inboxConversationKey(
  channel: string,
  phone: string,
  countryCode = "PT"
): string {
  // Canais entregam o remetente em formatos mistos ("912345678" local,
  // "351912…", "+351912…", "00351…", JID Evolution): a key vai para o
  // formato internacional com o indicativo do país da loja — formatos
  // equivalentes do mesmo número físico convergem na mesma conversa.
  return `${channel}:${internationalPhoneDigits(phone, countryCode)}`;
}

/** Indicativo do país da loja para a chave de conversa (uma query). */
async function shopCountryCode(prisma: DbClient): Promise<string> {
  const row = await prisma.shopSettings.findUnique({
    select: { countryCode: true },
    where: { id: "default" },
  });
  return row?.countryCode ?? "PT";
}

interface RecordBase {
  /** Momento do envio/receção; default now(). */
  at?: Date;
  channel: string;
  customerId?: string | null;
  /** RECEIVED por defeito; FAILED na reconciliação de falha de persistência. */
  deliveryStatus?: string;
  /** Id do gateway/Cloud para dedup — null grava sempre. */
  externalId?: string | null;
  phone: string;
  text: string;
}

export interface RecordedMessage {
  conversationId: string;
  created: boolean;
  messageId: string;
}

/** Casa o telefone com clientes (mesma regra do bot: sufixo só em PT). */
async function matchCustomer(
  prisma: DbClient,
  phone: string
): Promise<string | null> {
  const customers = await findCustomersByPhone(prisma, phone);
  return customers[0]?.id ?? null;
}

function subjectFor(channel: string): string {
  return CHANNEL_SUBJECT[channel] ?? channel;
}

/**
 * Grava uma mensagem inbound na conversa (canal+telefone). Idempotente:
 * externalId repetido devolve a mensagem existente sem duplicar nem
 * incrementar não-lidas.
 */
export async function recordInboundMessage(
  prisma: DbClient,
  log: InboxLogger,
  opts: RecordBase
): Promise<RecordedMessage | null> {
  const at = opts.at ?? new Date();
  const countryCode = await shopCountryCode(prisma);
  const key = inboxConversationKey(opts.channel, opts.phone, countryCode);
  // O phone guardado vai em dígitos internacionais (mesma regra da key)
  // — um número local como "912345678" gravado cru fazia o reply staff
  // enviar para "+912345678", entrega falhada.
  const intlPhone = internationalPhoneDigits(opts.phone, countryCode);
  if (opts.externalId) {
    const existing = await prisma.businessMessage.findFirst({
      where: { channel: opts.channel, externalId: opts.externalId },
      select: { deliveryStatus: true, id: true, conversationId: true },
    });
    if (existing?.conversationId) {
      // Recuperação após falha de persistência: o registo FAILED vira
      // RECEIVED quando a mensagem é finalmente processada (BUG #167 r10).
      if (existing.deliveryStatus === "FAILED") {
        await prisma.businessMessage
          .update({
            data: { deliveryStatus: "RECEIVED" },
            where: { id: existing.id },
          })
          .catch(() => undefined);
      }
      return {
        conversationId: existing.conversationId,
        created: false,
        messageId: existing.id,
      };
    }
  }
  const customerId =
    opts.customerId ?? (await matchCustomer(prisma, opts.phone));
  try {
    const [conversation, message] = await prisma.$transaction(async (tx) => {
      const conv = await tx.inboxConversation.upsert({
        create: {
          channel: opts.channel,
          conversationKey: key,
          customerId,
          escalatedAt: null,
          lastInboundAt: at,
          lastMessageAt: at,
          phone: intlPhone,
          unreadCount: 1,
        },
        update: {
          ...(customerId ? { customerId } : {}),
          phone: intlPhone,
          unreadCount: { increment: 1 },
        },
        where: { conversationKey: key },
      });
      // Mensagens recuperadas da fila chegam fora de ordem: as datas da
      // conversa nunca recuam — um retry antigo escondia conversas do
      // filtro "Sem resposta" (BUG #167 r9).
      await tx.inboxConversation.updateMany({
        where: {
          id: conv.id,
          OR: [
            { lastInboundAt: { equals: null } },
            { lastInboundAt: { lt: at } },
          ],
        },
        data: { lastInboundAt: at },
      });
      await tx.inboxConversation.updateMany({
        where: { id: conv.id, lastMessageAt: { lt: at } },
        data: { lastMessageAt: at },
      });
      const msg = await tx.businessMessage.create({
        data: {
          body: opts.text,
          channel: opts.channel,
          conversationId: conv.id,
          conversationKey: key,
          correspondent: intlPhone,
          customerId,
          deliveryStatus: opts.deliveryStatus ?? "RECEIVED",
          direction: "INBOUND",
          externalId: opts.externalId ?? null,
          subject: subjectFor(opts.channel),
        },
      });
      return [conv, msg] as const;
    });
    return {
      conversationId: conversation.id,
      created: true,
      messageId: message.id,
    };
  } catch (err) {
    // Corrida na unique (channel, externalId): a mensagem já existe —
    // idempotente por desenho, não erro.
    if (opts.externalId) {
      const existing = await prisma.businessMessage.findFirst({
        where: { channel: opts.channel, externalId: opts.externalId },
        select: { id: true, conversationId: true },
      });
      if (existing?.conversationId) {
        return {
          conversationId: existing.conversationId,
          created: false,
          messageId: existing.id,
        };
      }
    }
    log.warn({ err }, "inbox: recordInbound falhou");
    return null;
  }
}

/**
 * Grava uma mensagem outbound (bot, staff ou sistema/notificações) na
 * conversa. deliveryStatus: SENT | FAILED | PENDING.
 */
export async function recordOutboundMessage(
  prisma: DbClient,
  log: InboxLogger,
  opts: RecordBase & {
    conversationId?: string | null;
    createdById?: string | null;
    deliveryStatus?: string;
    handledBy: string;
  }
): Promise<RecordedMessage | null> {
  const at = opts.at ?? new Date();
  // Com conversationId conhecido (rascunho aprovado, reply staff) usa-se
  // a key/phone JÁ guardados — renormalizar o phone guardado (dígitos
  // internacionais sem "+") podia voltar a meter o indicativo da loja e
  // arquivar a resposta noutra conversa (ex.: "3547712345" numa loja US
  // → "13547712345"). A conversa certa é a que o staff abriu.
  let intlPhone: string;
  let key: string;
  const conv = opts.conversationId
    ? await prisma.inboxConversation.findUnique({
        select: { conversationKey: true, phone: true },
        where: { id: opts.conversationId },
      })
    : null;
  if (conv) {
    intlPhone = conv.phone;
    key = conv.conversationKey;
  } else {
    const countryCode = await shopCountryCode(prisma);
    intlPhone = internationalPhoneDigits(opts.phone, countryCode);
    key = inboxConversationKey(opts.channel, opts.phone, countryCode);
  }
  if (opts.externalId) {
    const existing = await prisma.businessMessage.findFirst({
      where: { channel: opts.channel, externalId: opts.externalId },
      select: { id: true, conversationId: true },
    });
    if (existing?.conversationId) {
      return {
        conversationId: existing.conversationId,
        created: false,
        messageId: existing.id,
      };
    }
  }
  const customerId =
    opts.customerId ?? (await matchCustomer(prisma, opts.phone));
  try {
    const [conversation, message] = await prisma.$transaction(async (tx) => {
      const conv = await tx.inboxConversation.upsert({
        create: {
          channel: opts.channel,
          conversationKey: key,
          customerId,
          lastMessageAt: at,
          lastOutboundAt: at,
          phone: intlPhone,
        },
        update: {
          ...(customerId ? { customerId } : {}),
          lastMessageAt: at,
          lastOutboundAt: at,
          phone: intlPhone,
        },
        where: { conversationKey: key },
      });
      const msg = await tx.businessMessage.create({
        data: {
          body: opts.text,
          channel: opts.channel,
          conversationId: conv.id,
          conversationKey: key,
          correspondent: intlPhone,
          createdById: opts.createdById ?? null,
          customerId,
          deliveryStatus: opts.deliveryStatus ?? "SENT",
          direction: "OUTBOUND",
          externalId: opts.externalId ?? null,
          handledBy: opts.handledBy,
          subject: subjectFor(opts.channel),
        },
      });
      return [conv, msg] as const;
    });
    return {
      conversationId: conversation.id,
      created: true,
      messageId: message.id,
    };
  } catch (err) {
    if (opts.externalId) {
      const existing = await prisma.businessMessage.findFirst({
        where: { channel: opts.channel, externalId: opts.externalId },
        select: { id: true, conversationId: true },
      });
      if (existing?.conversationId) {
        return {
          conversationId: existing.conversationId,
          created: false,
          messageId: existing.id,
        };
      }
    }
    log.warn({ err }, "inbox: recordOutbound falhou");
    return null;
  }
}

/** Marca a conversa como escalada para humano (pedido de ajuda, IA sem resposta). */
export async function escalateConversation(
  prisma: DbClient,
  conversationId: string
): Promise<void> {
  await prisma.inboxConversation.update({
    data: { escalatedAt: new Date(), status: INBOX_STATUS_OPEN },
    where: { id: conversationId },
  });
}

/** Zera não-lidas e marca readAt nas mensagens inbound por ler. */
export async function markConversationRead(
  prisma: DbClient,
  conversationId: string
): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.inboxConversation.update({
      data: { unreadCount: 0 },
      where: { id: conversationId },
    }),
    prisma.businessMessage.updateMany({
      data: { readAt: now },
      where: {
        conversationId,
        direction: "INBOUND",
        readAt: null,
      },
    }),
  ]);
}

/**
 * Últimas mensagens da conversa para o contexto da IA (§G.4): o bot
 * deixa de transportar histórico na request e lê a conversa persistida.
 * inbound → "user", outbound → "assistant".
 */
export async function getConversationHistory(
  prisma: DbClient,
  conversationId: string,
  limit = 6,
  excludeMessageId?: string
): Promise<{ role: "assistant" | "user"; content: string }[]> {
  const rows = await prisma.businessMessage.findMany({
    orderBy: { receivedAt: "desc" },
    select: { body: true, direction: true },
    take: limit,
    where: {
      conversationId,
      ...(excludeMessageId ? { id: { not: excludeMessageId } } : {}),
    },
  });
  return rows.reverse().map((r) => ({
    // URLs (links de assinatura, portal) nunca vão para o fornecedor de
    // IA — o histórico é contexto de conversa, não um arquivo de links.
    content: r.body.replace(/https?:\/\/\S+|www\.\S+/gi, "[link]"),
    role: (r.direction === "INBOUND" ? "user" : "assistant") as
      | "assistant"
      | "user",
  }));
}

/**
 * Retenção configurável (§G.1): apaga conversas fechadas/velhas cujo
 * lastMessageAt excede inboxRetentionDays. Mensagens ligadas por
 * conversationId ficam órfãs (SetNull) — o documento manual preserva-se;
 * só as mensagens com conversationKey (as da inbox) são apagadas, já que
 * são dados de trânsito, não registos comerciais.
 */
export async function cleanupInboxRetention(
  prisma: DbClient,
  log: InboxLogger
): Promise<number> {
  const settings = await prisma.shopSettings.findUnique({
    select: { inboxRetentionDays: true },
    where: { id: "default" },
  });
  const days = settings?.inboxRetentionDays ?? 365;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  // Uma só transação: SELECT FOR UPDATE (ordenado por id — ordem
  // determinista, mesma ordem em que as escritas tocam a conversa pelo
  // upsert) seguido do delete. Fora da tx uma mensagem nova podia entrar
  // entre a seleção e o delete e ficar órfã/ser apagada a meio.
  const removed = await prisma.$transaction(async (tx) => {
    const stale = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "inbox_conversations"
      WHERE "lastMessageAt" < ${cutoff}
      ORDER BY "id"
      FOR UPDATE`;
    if (stale.length === 0) {
      return 0;
    }
    const ids = stale.map((s) => s.id);
    // Filhos primeiro — mesma ordem de lock das escritas (mensagem
    // referencia a conversa), evita deadlock com o record*.
    await tx.businessMessage.deleteMany({
      where: { conversationId: { in: ids } },
    });
    await tx.inboxConversation.deleteMany({ where: { id: { in: ids } } });
    return stale.length;
  });
  if (removed > 0) {
    log.info({ days, removed }, "inbox: retenção aplicada");
  }
  return removed;
}
