import { beforeEach, describe, expect, it, vi } from "vitest";

// Fluxo Esquecimentos (item 5): resposta ao lembrete de saída —
// "SIM" → correção APROVADO; hora indicada → POR_VALIDAR; comando
// ponto mata o pending; SAIDA normal auto-corrige a presumida.

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
  deletePontoPhoto: vi.fn(() => Promise.resolve(undefined)),
  downloadEvolutionMedia: vi.fn(() => Promise.resolve(null)),
  findOpenPresumedExit: vi.fn(
    (): Promise<{ at: Date; id: string } | null> => Promise.resolve(null)
  ),
  getOrCreateShopSettings: vi.fn(),
  linkPontoPhoto: vi.fn(() => Promise.resolve(undefined)),
  pontoEntriesSince: vi.fn(
    (): Promise<Record<string, unknown>[]> => Promise.resolve([])
  ),
  recordPontoEntry: vi.fn((_prisma: unknown, _input: Record<string, unknown>) =>
    Promise.resolve({ id: "entry-new" })
  ),
  savePontoPhotoFile: vi.fn(() =>
    Promise.resolve({ id: "photo-1", path: "ponto-photos/u1/p.jpg" })
  ),
  timeEntryFindFirst: vi.fn(
    (): Promise<{ id: string } | null> => Promise.resolve(null)
  ),
  todayPontoEntries: vi.fn(
    (): Promise<Record<string, unknown>[]> => Promise.resolve([])
  ),
}));

vi.mock("../../../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));
vi.mock("../../cloud.service.js", () => ({ cloudFetch: mocks.cloudFetch }));
vi.mock("../../../lib/crypto.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../../lib/crypto.js")>();
  return { ...orig, decryptSecret: () => "test-shop-token" };
});
vi.mock("../../evolution.service.js", () => ({
  downloadEvolutionMedia: mocks.downloadEvolutionMedia,
}));
vi.mock("../entries.js", () => ({
  deletePontoPhoto: mocks.deletePontoPhoto,
  findOpenPresumedExit: mocks.findOpenPresumedExit,
  linkPontoPhoto: mocks.linkPontoPhoto,
  pontoEntriesSince: mocks.pontoEntriesSince,
  recordPontoEntry: mocks.recordPontoEntry,
  savePontoPhotoFile: mocks.savePontoPhotoFile,
  todayPontoEntries: mocks.todayPontoEntries,
}));
vi.mock("../../bot-ai.js", () => ({ askBotAi: vi.fn() }));
vi.mock("../../../repositories/notification.repository.js", () => ({
  createManyAndReturnInAppNotifications: vi.fn(() => Promise.resolve([])),
  findManyUsers: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../job-quote.service.js", () => ({
  respondToQuote: vi.fn(() => Promise.resolve({ error: undefined })),
}));

import type {
  BotReplyCtx,
  InboundMessage,
  InboundTransport,
} from "../../bot-intents.js";
import { tryHandlePontoStaff } from "../handler.js";
import {
  clearAllPendingPonto,
  getPendingPontoExit,
  PONTO_EXIT_PENDING_TTL_MS,
  setPendingPontoExit,
} from "../state.js";

let phoneSeq = 900;
function nextPhone(): string {
  phoneSeq += 1;
  return `3519${String(phoneSeq).padStart(7, "0")}`;
}

const TZ = "Europe/Lisbon";
// 2026-01-10 18:00 em Lisboa (UTC+0 no inverno) — a presumida típica.
const PRESUMED_AT = new Date("2026-01-10T18:00:00.000Z");

function setup(opts: { smsAllowed?: boolean; transport?: string } = {}) {
  const phone = nextPhone();
  const staff = {
    externalWork: false,
    id: "user-1",
    name: "Rui Silva",
    phoneE164: `+${phone}`,
    pontoSmsAllowed: opts.smsAllowed ?? false,
    username: "rui",
  };
  const prisma = {
    customer: { findMany: vi.fn(() => Promise.resolve([])) },
    job: { findMany: vi.fn(() => Promise.resolve([])) },
    timeEntry: { findFirst: mocks.timeEntryFindFirst },
    user: { findMany: vi.fn(() => Promise.resolve([staff])) },
  };
  const sent: string[] = [];
  const t: InboundTransport = {
    channelLabel: "WhatsApp",
    ponto: {
      interactive: vi.fn(() => Promise.resolve(true)),
      transport: (opts.transport ?? "whatsapp_meta") as never,
    },
    send: vi.fn((text: string) => {
      sent.push(text);
      return Promise.resolve(true);
    }),
  } as InboundTransport;
  const ctx = {
    currency: "EUR",
    log: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as never,
    notifyCtx: undefined,
    prisma: prisma as never,
    shopLabel: "Loja X",
    timezone: TZ,
  } satisfies BotReplyCtx;
  const message = (text: string): InboundMessage => ({
    createdAt: new Date("2026-01-10T18:30:00.000Z").toISOString(),
    fromPhone: phone,
    id: `m-${Math.random().toString(36).slice(2)}`,
    messageType: "text",
    text,
  });
  return { ctx, message, phone, prisma, sent, staff, t };
}

function armPending(userId = "user-1", shiftOpenAt?: string) {
  setPendingPontoExit(userId, {
    expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
    presumedAt: PRESUMED_AT.toISOString(),
    presumedEntryId: "presumed-1",
    ...(shiftOpenAt ? { shiftOpenAt } : {}),
    userId,
  });
}

beforeEach(() => {
  clearAllPendingPonto();
  vi.clearAllMocks();
  mocks.getOrCreateShopSettings.mockResolvedValue({
    cloudApiUrl: "https://cloud.test",
    cloudEntitlements: ["ponto"],
    cloudShopTokenEncrypted: "enc-token",
    cloudSyncedAt: new Date(),
    countryCode: "PT",
    pontoExternalAutoApprove: true,
    pontoGeoLat: 38.72,
    pontoGeoLng: -9.14,
    pontoRadiusM: 100,
    timezone: TZ,
  });
  mocks.cloudFetch.mockResolvedValue({
    body: { proofs: { insideRadius: true }, status: "APROVADO" },
    ok: true,
    status: 200,
  });
  mocks.todayPontoEntries.mockResolvedValue([
    {
      at: new Date("2026-01-10T08:00:00.000Z"),
      status: "APROVADO",
      type: "ENTRADA",
    },
  ]);
});

describe("resposta ao lembrete de saída", () => {
  it("SIM → correção SAIDA APROVADO com correctsId→presumida", async () => {
    const { ctx, message, sent, t } = setup();
    armPending();

    const handled = await tryHandlePontoStaff(ctx, message("SIM"), t);

    expect(handled).toBe(true);
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({
      at: PRESUMED_AT,
      correctsId: "presumed-1",
      reason: "confirmado pelo trabalhador",
      status: "APROVADO",
      transport: "WHATSAPP_META",
      type: "SAIDA",
      userId: "user-1",
    });
    expect(entry.proofs).toMatchObject({ exitReminderConfirmed: true });
    expect(sent.at(-1)).toContain("Saída às 18:00");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("hora indicada (18:05) → correção POR_VALIDAR na hora declarada", async () => {
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("saí às 18:05"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({
      correctsId: "presumed-1",
      reason: "hora de saída indicada pelo trabalhador",
      status: "POR_VALIDAR",
      type: "SAIDA",
    });
    // 18:05 em Lisboa no inverno = 18:05Z.
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:05:00.000Z");
    expect(entry.proofs).toMatchObject({ exitReminderTimeDeclared: true });
  });

  it('hora de tarde sem minutos ("6") → 18:00 POR_VALIDAR', async () => {
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("saí às 6"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry.status).toBe("POR_VALIDAR");
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:00:00.000Z");
  });

  it("texto irreconhecível → repete a pergunta e pending continua", async () => {
    const { ctx, message, sent, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("não sei"), t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("Responda SIM");
    expect(getPendingPontoExit("user-1")).not.toBeNull();
  });

  it("negação com a hora presumida → não regista, repete a pergunta", async () => {
    const { ctx, message, sent, t } = setup();
    armPending();

    await tryHandlePontoStaff(
      ctx,
      message("Não saí às 18:00, ainda estou a trabalhar"),
      t
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("Responda SIM");
    expect(getPendingPontoExit("user-1")).not.toBeNull();
  });

  it("negação à pergunta + hora afirmada → regista a hora nova", async () => {
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("Não, saí às 18:20"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:20:00.000Z");
  });

  it("resposta depois da meia-noite → hora declarada fica no dia da resposta", async () => {
    const { ctx, message, t } = setup();
    // Lembrete das 23:30, entrada às 16:00 — resposta «00:15» às 00:20
    // declara uma saída do dia seguinte, não antes da entrada.
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      shiftOpenAt: "2026-01-10T16:00:00.000Z",
      userId: "user-1",
    });
    const msg = {
      ...message("00:15"),
      createdAt: "2026-01-11T00:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-11T00:15:00.000Z");
  });

  it("dois dias plausíveis → repete a pergunta em vez de gravar data arbitrária", async () => {
    const { ctx, message, sent, t } = setup();
    // Pending antigo sem shiftOpenAt (armado antes da atualização):
    // sem o limite do turno, "00:15" serve para os dois dias.
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      userId: "user-1",
    });
    const msg = {
      ...message("00:15"),
      createdAt: "2026-01-11T00:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("Responda SIM");
    expect(getPendingPontoExit("user-1")).not.toBeNull();
  });

  it("comando ponto normal mata o pending de saída", async () => {
    const { ctx, message, t } = setup();
    armPending();

    // ESTADO é comando — não cria entry, mas deve limpar o pending.
    await tryHandlePontoStaff(ctx, message("ESTADO"), t);

    expect(getPendingPontoExit("user-1")).toBeNull();
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });

  it("pending expirado (~2h) → texto normal, sem correção", async () => {
    const { ctx, message, sent, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() - 1000,
      presumedAt: PRESUMED_AT.toISOString(),
      presumedEntryId: "presumed-1",
      userId: "user-1",
    });

    await tryHandlePontoStaff(ctx, message("SIM"), t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("Comandos do livro de ponto");
  });

  it("presumida já corrigida entretanto → pending morre sem duplicar", async () => {
    const { ctx, message, sent, t } = setup();
    armPending();
    mocks.timeEntryFindFirst.mockResolvedValue({ id: "corr-1" });

    await tryHandlePontoStaff(ctx, message("SIM"), t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1")).toBeNull();
    expect(sent.at(-1)).toContain("Comandos do livro de ponto");
  });
});

describe("SAIDA normal após presumida", () => {
  it("auto-corrige: correctsId→presumida + razão de registo manual", async () => {
    const { ctx, message, t } = setup({ smsAllowed: true, transport: "sms" });
    mocks.findOpenPresumedExit.mockResolvedValue({
      at: PRESUMED_AT,
      id: "presumed-1",
    });

    await tryHandlePontoStaff(ctx, message("SAIDA"), t);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({
      correctsId: "presumed-1",
      reason: "saída registada pelo trabalhador",
      type: "SAIDA",
    });
  });
});
