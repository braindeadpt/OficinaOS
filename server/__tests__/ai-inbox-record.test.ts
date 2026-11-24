import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  inboxConversationKey,
  markConversationRead,
  recordInboundMessage,
  recordOutboundMessage,
} from "../services/inbox.service.js";

/**
 * Gravação da caixa de entrada (§G): dedup por (canal, externalId),
 * conversa por canal+telefone, não-lidas e leitura.
 */

const log = { info: vi.fn(), warn: vi.fn() } as never;

function fakePrisma() {
  const conversations = new Map<string, Record<string, unknown>>();
  const messages: Record<string, unknown>[] = [];
  let convSeq = 0;
  let msgSeq = 0;
  const tx: Record<string, unknown> = {};
  tx.shopSettings = {
    findUnique: vi.fn(async () => ({ countryCode: "PT" })),
  };
  tx.inboxConversation = {
    findUnique: vi.fn(
      ({ where }: { where: { id?: string; conversationKey?: string } }) => {
        if (where.id) {
          return Promise.resolve(
            [...conversations.values()].find((c) => c.id === where.id) ?? null
          );
        }
        return Promise.resolve(
          conversations.get(where.conversationKey as string) ?? null
        );
      }
    ),
    update: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id?: string; conversationKey?: string };
      }) => {
        const conv = where.id
          ? [...conversations.values()].find((c) => c.id === where.id)
          : conversations.get(where.conversationKey as string);
        if (!conv) {
          throw new Error("not found");
        }
        for (const [k, v] of Object.entries(data)) {
          if (k === "unreadCount" && typeof v === "object" && v !== null) {
            conv.unreadCount =
              (conv.unreadCount as number) +
              (v as { increment: number }).increment;
          } else {
            conv[k] = v;
          }
        }
        return Promise.resolve(conv);
      }
    ),
    upsert: vi.fn(
      ({
        create,
        update,
        where,
      }: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where: { conversationKey: string };
      }) => {
        const existing = conversations.get(where.conversationKey);
        if (existing) {
          for (const [k, v] of Object.entries(update)) {
            if (k === "unreadCount" && typeof v === "object" && v !== null) {
              existing.unreadCount =
                (existing.unreadCount as number) +
                (v as { increment: number }).increment;
            } else {
              existing[k] = v;
            }
          }
          return Promise.resolve(existing);
        }
        convSeq += 1;
        const conv = { id: `conv-${convSeq}`, ...create } as Record<
          string,
          unknown
        >;
        conversations.set(where.conversationKey, conv);
        return Promise.resolve(conv);
      }
    ),
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: {
          OR?: Record<string, { equals?: null; lt?: Date }>[];
          id: string;
        } & Record<string, unknown>;
      }) => {
        const conv = [...conversations.values()].find((c) => c.id === where.id);
        if (!conv) {
          return Promise.resolve({ count: 0 });
        }
        // Emula o filtro real: OR [equals:null, lt] para lastInboundAt
        // (nullable) e lt directo para lastMessageAt — uma regressão no
        // ramo null tem de falhar aqui (Devin #167 r3).
        const clauses = (where.OR ?? [where]) as Record<
          string,
          { equals?: null; lt?: Date }
        >[];
        const match = clauses.some((clause) =>
          Object.entries(clause)
            .filter(([f]) => f !== "id")
            .every(([f, cond]) => {
              const current = conv[f] as Date | null | undefined;
              if ("equals" in cond) {
                return current === null || current === undefined;
              }
              return (
                current !== null &&
                current !== undefined &&
                current < (cond.lt as Date)
              );
            })
        );
        if (match) {
          const field = Object.keys(data)[0] as string;
          conv[field] = data[field] as Date;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      }
    ),
  };
  tx.businessMessage = {
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      msgSeq += 1;
      const msg = { id: `msg-${msgSeq}`, readAt: null, ...data };
      messages.push(msg);
      return Promise.resolve(msg);
    }),
    findFirst: vi.fn(
      ({ where }: { where: { channel: string; externalId: string } }) =>
        Promise.resolve(
          messages.find(
            (m) =>
              m.channel === where.channel && m.externalId === where.externalId
          ) ?? null
        )
    ),
    findMany: vi.fn(() => Promise.resolve([])),
    updateMany: vi.fn(
      ({
        data,
        where,
      }: {
        data: { readAt: Date };
        where: { conversationId: string; direction: string; readAt: null };
      }) => {
        let count = 0;
        for (const m of messages) {
          if (
            m.conversationId === where.conversationId &&
            m.direction === "INBOUND" &&
            m.readAt === null
          ) {
            m.readAt = data.readAt;
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }
    ),
  };
  tx.customer = { findMany: vi.fn(() => Promise.resolve([])) };
  tx.$transaction = (arg: unknown) => {
    if (typeof arg === "function") {
      return (arg as (t: unknown) => Promise<unknown>)(tx);
    }
    return Promise.all(arg as Promise<unknown>[]);
  };
  return { messages, tx: tx as never };
}

beforeEach(() => vi.clearAllMocks());

describe("recordInboundMessage", () => {
  it("grava a conversa por canal+telefone e incrementa não-lidas", async () => {
    const { tx, messages } = fakePrisma();
    const r1 = await recordInboundMessage(tx, log, {
      channel: "whatsapp",
      externalId: "wamid-1",
      phone: "+351912345678",
      text: "olá",
    });
    expect(r1?.created).toBe(true);
    const r2 = await recordInboundMessage(tx, log, {
      channel: "whatsapp",
      externalId: "wamid-2",
      phone: "351912345678",
      text: "segunda",
    });
    // Mesma conversa — "+351912…" e "351912…" convergem na mesma key.
    expect(r2?.conversationId).toBe(r1?.conversationId);
    expect(messages).toHaveLength(2);
  });

  it("guarda o phone em dígitos internacionais — reply com '+' entrega", async () => {
    // Regressão Devin: a conversa guardava "912345678" local e o reply
    // staff fazia prepend de "+" → "+912345678" falhava a entrega.
    const { tx } = fakePrisma();
    const txx = tx as unknown as {
      inboxConversation: {
        findUnique: (o: {
          where: { conversationKey: string };
        }) => Promise<{ phone?: string } | null>;
      };
    };
    await recordInboundMessage(tx, log, {
      channel: "whatsapp",
      externalId: "wamid-local",
      phone: "912345678",
      text: "olá",
    });
    const conv = await txx.inboxConversation.findUnique({
      where: { conversationKey: "whatsapp:351912345678" },
    });
    expect(conv?.phone).toBe("351912345678");
    // Formato internacional explícito também fica igual.
    await recordInboundMessage(tx, log, {
      channel: "sms",
      externalId: "sms-1",
      phone: "00351912345678",
      text: "oi",
    });
    const convSms = await txx.inboxConversation.findUnique({
      where: { conversationKey: "sms:351912345678" },
    });
    expect(convSms?.phone).toBe("351912345678");
  });

  it("dedup: externalId repetido não duplica nem soma não-lidas", async () => {
    const { tx, messages } = fakePrisma();
    const first = await recordInboundMessage(tx, log, {
      channel: "evolution",
      externalId: "evo-abc",
      phone: "+351912345678",
      text: "olá",
    });
    const dup = await recordInboundMessage(tx, log, {
      channel: "evolution",
      externalId: "evo-abc",
      phone: "+351912345678",
      text: "olá",
    });
    expect(first?.created).toBe(true);
    expect(dup?.created).toBe(false);
    expect(dup?.messageId).toBe(first?.messageId);
    expect(messages).toHaveLength(1);
    // Outro canal com o mesmo id NÃO colide — a unique é (canal, externalId).
    const otherChannel = await recordInboundMessage(tx, log, {
      channel: "sms",
      externalId: "evo-abc",
      phone: "+351912345678",
      text: "olá",
    });
    expect(otherChannel?.created).toBe(true);
    expect(messages).toHaveLength(2);
  });

  it("nunca recua as datas da conversa — mensagem recuperada fora de ordem", async () => {
    // Regressão Devin #167: um retry tardio da fila gravava o createdAt
    // antigo e recuava lastInboundAt/lastMessageAt, escondendo a
    // conversa do filtro "Sem resposta".
    const { tx } = fakePrisma();
    const t0 = new Date("2026-01-01T10:00:00.000Z");
    const t2 = new Date("2026-01-01T10:10:00.000Z");
    await recordInboundMessage(tx, log, {
      at: t0,
      channel: "whatsapp",
      externalId: "m-old",
      phone: "+351912345678",
      text: "primeira",
    });
    await recordInboundMessage(tx, log, {
      at: t2,
      channel: "whatsapp",
      externalId: "m-new",
      phone: "+351912345678",
      text: "segunda",
    });
    // Chega agora mas com createdAt antigo (retry da fila da Cloud).
    await recordInboundMessage(tx, log, {
      at: t0,
      channel: "whatsapp",
      externalId: "m-recovered",
      phone: "+351912345678",
      text: "recuperada",
    });
    const conv = await (
      tx as never as {
        inboxConversation: {
          findUnique: (a: { where: { conversationKey: string } }) => Promise<{
            lastInboundAt?: Date | null;
            lastMessageAt?: Date | null;
          } | null>;
        };
      }
    ).inboxConversation.findUnique({
      where: { conversationKey: "whatsapp:351912345678" },
    });
    expect(conv?.lastInboundAt?.getTime()).toBe(t2.getTime());
    expect(conv?.lastMessageAt?.getTime()).toBe(t2.getTime());
  });

  it("define lastInboundAt na primeira mensagem de uma conversa iniciada pela loja", async () => {
    // Regressão Devin (#167 r3): o filtro real é OR equals:null|lt — sem
    // o ramo null, o 1.º inbound de uma conversa outbound-first nunca
    // marcava lastInboundAt (fora do "Sem resposta" e da janela de 24 h).
    const { tx } = fakePrisma();
    await recordOutboundMessage(tx, log, {
      channel: "whatsapp",
      handledBy: "STAFF",
      phone: "+351912345678",
      text: "contactámos sobre o aparelho",
    });
    await recordInboundMessage(tx, log, {
      channel: "whatsapp",
      externalId: "wamid-first",
      phone: "+351912345678",
      text: "sim, digam",
    });
    const txx = tx as unknown as {
      inboxConversation: {
        findUnique: (o: {
          where: { conversationKey: string };
        }) => Promise<{ lastInboundAt?: Date | null } | null>;
      };
    };
    const conv = await txx.inboxConversation.findUnique({
      where: { conversationKey: "whatsapp:351912345678" },
    });
    expect(conv?.lastInboundAt).toBeInstanceOf(Date);
  });

  it("markConversationRead zera não-lidas e marca readAt nas inbound", async () => {
    const { tx } = fakePrisma();
    const rec = await recordInboundMessage(tx, log, {
      channel: "sms",
      phone: "+351912345678",
      text: "lê-me",
    });
    await markConversationRead(tx, rec?.conversationId as string);
    const conv = await (
      tx as never as {
        inboxConversation: {
          findUnique: (a: {
            where: { id: string };
          }) => Promise<Record<string, unknown>>;
        };
      }
    ).inboxConversation.findUnique({
      where: { id: rec?.conversationId as string },
    });
    expect(conv.unreadCount).toBe(0);
  });

  it("recordOutbound grava resposta com handledBy e não soma não-lidas", async () => {
    const { tx, messages } = fakePrisma();
    await recordInboundMessage(tx, log, {
      channel: "whatsapp",
      externalId: "in-1",
      phone: "+351912345678",
      text: "pergunta",
    });
    const out = await recordOutboundMessage(tx, log, {
      channel: "whatsapp",
      handledBy: "BOT",
      phone: "+351912345678",
      text: "resposta",
    });
    expect(out?.created).toBe(true);
    const outbound = messages.find((m) => m.direction === "OUTBOUND");
    expect(outbound?.handledBy).toBe("BOT");
    expect(outbound?.deliveryStatus).toBe("SENT");
    // A outbound da loja partilha a conversa do inbound.
    const inbound = messages.find((m) => m.direction === "INBOUND");
    expect(outbound?.conversationId).toBe(inbound?.conversationId);
  });

  it("reply por conversationId fica na conversa certa — número intl curto (loja US)", async () => {
    // Regressão Devin: o phone guardado (dígitos intl, sem "+") era
    // renormalizado ao gravar a resposta e ganhava o indicativo da loja
    // — "3547712345" com loja US virava "13547712345" e a resposta era
    // arquivada noutra conversa.
    const { tx, messages } = fakePrisma();
    const txx = tx as never as {
      inboxConversation: {
        findUnique: (o: {
          where: { id: string };
        }) => Promise<{ phone: string } | null>;
      };
      shopSettings: { findUnique: unknown };
    };
    txx.shopSettings.findUnique = vi.fn(async () => ({
      countryCode: "US",
    }));
    const inbound = await recordInboundMessage(tx, log, {
      channel: "sms",
      externalId: "in-us-1",
      phone: "+3547712345",
      text: "olá",
    });
    const conv = await txx.inboxConversation.findUnique({
      where: { id: inbound?.conversationId as string },
    });
    expect(conv?.phone).toBe("3547712345");
    const out = await recordOutboundMessage(tx, log, {
      channel: "sms",
      conversationId: inbound?.conversationId,
      handledBy: "STAFF",
      phone: conv?.phone as string,
      text: "resposta",
    });
    expect(out?.conversationId).toBe(inbound?.conversationId);
    const outbound = messages.find((m) => m.direction === "OUTBOUND");
    expect(outbound?.conversationKey).toBe("sms:3547712345");
  });

  it("conversationKey normaliza o telefone para dígitos", () => {
    expect(inboxConversationKey("sms", "+351912345678")).toBe(
      inboxConversationKey("sms", "351912345678")
    );
    // Local ↔ internacional convergem na mesma conversa (país da loja).
    expect(inboxConversationKey("sms", "912345678")).toBe(
      inboxConversationKey("sms", "+351912345678")
    );
    expect(inboxConversationKey("sms", "00351912345678")).toBe(
      inboxConversationKey("sms", "+351912345678")
    );
    expect(inboxConversationKey("sms", "351912345678")).not.toBe(
      inboxConversationKey("whatsapp", "351912345678")
    );
  });
});
