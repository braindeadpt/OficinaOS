import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fluxos do livro de ponto com fakes: prisma (só user.findMany é real —
// staff.ts), settings.repository, cloudFetch (evaluate), crypto e
// entries.js (timeEntry/pontoPhoto). state.ts e rate-limit.ts correm a
// valer — cada teste usa um telefone distinto para não esgotar o
// balde horário de 30/h do scope "ponto".

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
    Promise.resolve({ id: "entry-1" })
  ),
  savePontoPhotoFile: vi.fn(
    (
      _prisma: unknown,
      _userId: string,
      _buffer: Buffer,
      _hintedMime?: string | null
    ): Promise<{ id: string; path: string } | null> =>
      Promise.resolve({ id: "photo-1", path: "ponto-photos/u1/p.jpg" })
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
// Dependências do pipeline de clientes — o ponto tem de as evitar.
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
import { handleInboundMessage } from "../../bot-intents.js";
import { tryHandlePontoStaff } from "../handler.js";
import { clearAllPendingPonto, PONTO_PHOTO_TTL_MS } from "../state.js";

// Telefone único por caso — rateOk(phone, 30, "ponto") é real.
let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `3519${String(phoneSeq).padStart(7, "0")}`;
}

function staffUserFor(phone: string, over: Record<string, unknown> = {}) {
  return {
    externalWork: false,
    id: "user-1",
    name: "Rui Silva",
    phoneE164: `+${phone}`,
    pontoSmsAllowed: false,
    username: "rui",
    ...over,
  };
}

function makeSettings(over: Record<string, unknown> = {}) {
  return {
    cloudApiUrl: "https://cloud.test",
    cloudEntitlements: ["ponto", "whatsapp-bot"],
    cloudShopTokenEncrypted: "enc-token",
    cloudSyncedAt: new Date(),
    countryCode: "PT",
    pontoExternalAutoApprove: true,
    pontoExternalPhotoRequired: false,
    pontoGeoLat: 38.72,
    pontoGeoLng: -9.14,
    pontoRadiusM: 100,
    timezone: "Europe/Lisbon",
    ...over,
  };
}

function makePrisma(staffUsers: unknown[] = [], customers: unknown[] = []) {
  return {
    // findCustomersByPhone (bot-intents) pré-filtra em SQL sobre os
    // dígitos e lê o país da loja em shopSettings — o mock devolve as
    // fichas ao $queryRaw e deixa o casamento exato em memória decidir.
    $queryRaw: vi.fn(() => Promise.resolve(customers)),
    customer: {
      findMany: vi.fn(() => Promise.resolve(customers)),
      update: vi.fn(() => Promise.resolve({})),
    },
    job: { findMany: vi.fn(() => Promise.resolve([])) },
    shopSettings: {
      findUnique: vi.fn(() => Promise.resolve({ countryCode: "PT" })),
    },
    user: { findMany: vi.fn(() => Promise.resolve(staffUsers)) },
  };
}

function makeCtx(prisma: ReturnType<typeof makePrisma>) {
  return {
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
    timezone: "Europe/Lisbon",
  } satisfies BotReplyCtx;
}

function makeTransport(over: Partial<InboundTransport> = {}) {
  const sent: string[] = [];
  const interactive: Record<string, unknown>[] = [];
  const t: InboundTransport = {
    channelLabel: "WhatsApp",
    ponto: {
      interactive: vi.fn((pl: Record<string, unknown>) => {
        interactive.push(pl);
        return Promise.resolve(true);
      }),
      transport: "whatsapp_meta",
    },
    send: vi.fn((text: string) => {
      sent.push(text);
      return Promise.resolve(true);
    }),
    ...over,
  };
  return { interactive, sent, t };
}

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    createdAt: new Date().toISOString(),
    fromPhone: "",
    id: `m-${Math.random().toString(36).slice(2)}`,
    messageType: "text",
    text: null,
    ...over,
  };
}

/** Setup padrão: staff + prisma + ctx + transporte meta. */
function setup(
  over: {
    prisma?: ReturnType<typeof makePrisma>;
    settings?: Record<string, unknown>;
    staffOver?: Record<string, unknown>;
    transportOver?: Partial<InboundTransport>;
  } = {}
) {
  const phone = nextPhone();
  const staff = staffUserFor(phone, over.staffOver);
  const prisma = over.prisma ?? makePrisma([staff]);
  const { interactive, sent, t } = makeTransport(over.transportOver);
  return {
    ctx: makeCtx(prisma),
    interactive,
    phone,
    prisma,
    sent,
    staff,
    t,
  };
}

/** Texto do último payload interativo (body.text) — confirmações e
 *  pedidos interativos do canal oficial vivem aqui, não em `sent`. */
function lastInteractiveText(interactive: Record<string, unknown>[]): string {
  const last = interactive.at(-1) as { body?: { text?: string } } | undefined;
  return last?.body?.text ?? "";
}

function cloudOk(status = "APROVADO", extra: Record<string, unknown> = {}) {
  mocks.cloudFetch.mockResolvedValue({
    body: { proofs: { insideRadius: true }, status, ...extra },
    ok: true,
    status: 200,
  });
}

function evaluateBody(): Record<string, unknown> {
  const call = mocks.cloudFetch.mock.calls.find(
    (c) => c[1] === "/ponto/evaluate"
  );
  return (call?.[2] as { body: Record<string, unknown> })?.body ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAllPendingPonto();
  // makeSettings avalia-se na chamada, não aqui: os testes com timers
  // falsos recuam o relógio para janeiro e um cloudSyncedAt criado em
  // tempo real ficaria meses no futuro — isModuleEnabled rejeita
  // syncs futuros (skew >5 min) e o gate do ponto fechava.
  mocks.getOrCreateShopSettings.mockImplementation(() =>
    Promise.resolve(makeSettings())
  );
  cloudOk();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tryHandlePontoStaff — gates", () => {
  it("sem t.ponto → false (canal não fala ponto)", async () => {
    const { ctx, phone, t } = setup();
    const noPonto: InboundTransport = { ...t, ponto: undefined };
    expect(
      await tryHandlePontoStaff(
        ctx,
        msg({ fromPhone: phone, text: "PAUSA" }),
        noPonto
      )
    ).toBe(false);
  });

  it("telefone sem staff ponto → false", async () => {
    const prisma = makePrisma([]);
    const { ctx, t } = setup({ prisma });
    const phone = nextPhone();
    expect(
      await tryHandlePontoStaff(
        ctx,
        msg({ fromPhone: phone, text: "PAUSA" }),
        t
      )
    ).toBe(false);
  });

  it("módulo ponto desligado → false (pipeline normal)", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(
      makeSettings({ cloudEntitlements: ["whatsapp-bot"] })
    );
    const { ctx, phone, t } = setup();
    expect(
      await tryHandlePontoStaff(
        ctx,
        msg({ fromPhone: phone, text: "PAUSA" }),
        t
      )
    ).toBe(false);
  });

  it("rate limit estourado → consome sem responder", async () => {
    const phone = "351977777777";
    const staff = staffUserFor(phone);
    const prisma = makePrisma([staff]);
    const ctx = makeCtx(prisma);
    const { sent, t } = makeTransport();
    // 30 mensagens na janela horária — a 31.ª é consumida em silêncio.
    for (let i = 0; i < 30; i++) {
      await tryHandlePontoStaff(
        ctx,
        msg({ fromPhone: phone, text: "obrigado" }),
        t
      );
    }
    const before = sent.length;
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ESTADO" }),
      t
    );
    expect(handled).toBe(true);
    expect(sent.length).toBe(before);
  });
});

describe("comandos sem fluxo", () => {
  it("texto irreconhecível → lista de comandos", async () => {
    const { ctx, phone, sent, t } = setup();
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "obrigado" }),
      t
    );
    expect(handled).toBe(true);
    expect(sent[0]).toContain("ENTRADA");
    expect(sent[0]).toContain("ESTADO");
  });

  it("PARAR de staff → handler ponto responde, nunca consentimento", async () => {
    const { ctx, phone, sent, t } = setup();
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "PARAR" }),
      t
    );
    expect(handled).toBe(true);
    expect(sent[0]).toContain("Comandos");
  });

  it("ESTADO → resumo do dia e da semana", async () => {
    const { ctx, phone, sent, t } = setup();
    mocks.pontoEntriesSince.mockResolvedValue([
      { at: new Date(), status: "APROVADO", type: "ENTRADA" },
    ]);
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ESTADO" }),
      t
    );
    expect(handled).toBe(true);
    expect(sent[0]).toContain("Hoje:");
    expect(sent[0]).toContain("Semana:");
  });

  it("ESTADO: horas da semana somam intervalos por dia civil — entrada de ontem sem saída não infla", async () => {
    vi.useFakeTimers();
    // Quarta 07/01/2026 — a semana começa segunda 05/01 (Europe/Lisbon
    // em janeiro = UTC).
    vi.setSystemTime(new Date("2026-01-07T12:00:00Z"));
    const { ctx, phone, sent, t } = setup();
    mocks.pontoEntriesSince.mockResolvedValue([
      // Segunda: ENTRADA sem SAIDA (esqueceu-se) — intervalo aberto
      // não pode fechar na saída de terça e inflar ~32 h.
      {
        at: new Date("2026-01-05T09:00:00Z"),
        status: "APROVADO",
        type: "ENTRADA",
      },
      // Terça: turno completo 09:00→17:00 = 8 h.
      {
        at: new Date("2026-01-06T09:00:00Z"),
        status: "APROVADO",
        type: "ENTRADA",
      },
      {
        at: new Date("2026-01-06T17:00:00Z"),
        status: "APROVADO",
        type: "SAIDA",
      },
    ]);
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ESTADO" }),
      t
    );
    // Sem overnight: segunda corta à meia-noite (09:00→24:00 = 15 h
    // provisórias, como no painel) + terça 8 h — nunca as ~32 h do
    // emparelhamento entre dias.
    expect(sent[0]).toContain("Semana: 23h00");
    expect(sent[0]).not.toContain("32h");
  });

  it("ESTADO: saída corrigida depois da meia-noite conta no seu próprio dia civil (sem overnight)", async () => {
    vi.useFakeTimers();
    // Sábado 10/01/2026 00:20 Lisboa (UTC+0) — semana aberta segunda.
    vi.setSystemTime(new Date("2026-01-10T00:20:00Z"));
    const { ctx, phone, sent, t } = setup();
    mocks.pontoEntriesSince.mockResolvedValue([
      // Sexta: ENTRADA 16:00; a resposta ao lembrete gravou a SAIDA às
      // 00:15 de sábado ligada à presumida das 23:30 de sexta.
      {
        at: new Date("2026-01-09T16:00:00Z"),
        status: "APROVADO",
        type: "ENTRADA",
      },
      {
        at: new Date("2026-01-10T00:15:00Z"),
        corrects: { at: new Date("2026-01-09T23:30:00Z") },
        status: "APROVADO",
        type: "SAIDA",
      },
    ]);

    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ESTADO" }),
      t
    );

    // Alinhado com o painel (decisão 2026-11-25): a correção conta no
    // SEU dia civil — sábado tem a saída sem entrada (0h00 hoje) e
    // sexta corta à meia-noite: 16:00→24:00 = 8h00, não 8h15.
    expect(sent[0]).toContain("Hoje: 0h00 — Saída 00:15");
    expect(sent[0]).toContain("Semana: 8h00");
  });
});

describe("fluxo ENTRADA staff (QR + localização)", () => {
  it("ENTRADA sem código → pede o QR, sem pendente", async () => {
    const { ctx, phone, sent, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA" }),
      t
    );
    expect(sent[0]).toContain("QR");
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("ENTRADA com código → location_request interativo + pending", async () => {
    const { ctx, interactive, phone, sent, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA loja-x 4821" }),
      t
    );
    expect(interactive).toHaveLength(1);
    expect(interactive[0]).toMatchObject({
      action: { name: "send_location" },
      type: "location_request_message",
    });
    expect(sent).toHaveLength(0);
  });

  it("localização completa → evaluate + TimeEntry + confirmação com botões", async () => {
    const { ctx, interactive, phone, sent, t } = setup();
    const at = new Date().toISOString();
    await tryHandlePontoStaff(
      ctx,
      msg({ createdAt: at, fromPhone: phone, text: "ENTRADA loja-x 4821" }),
      t
    );
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date(Date.now() + 30_000).toISOString(),
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(handled).toBe(true);
    const body = evaluateBody();
    expect(body).toMatchObject({
      code: "4821",
      hasPhoto: false,
      messageAt: at,
      phone,
      transport: "whatsapp_meta",
      type: "ENTRADA",
    });
    expect(body.location).toMatchObject({ lat: 38.72, lng: -9.14 });
    // Contrato WP0.1: geo/raio, flags e "tem entrada hoje" são lidos pela
    // Cloud da configuração autoritativa — não seguem no payload.
    expect(body.shopGeo).toBeUndefined();
    expect(body.user).toBeUndefined();
    expect(body.externalAutoApprove).toBeUndefined();
    expect(body.photoRequired).toBeUndefined();
    expect(body.todayHasEntry).toBeUndefined();
    expect(mocks.recordPontoEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "APROVADO",
        transport: "WHATSAPP_META",
        type: "ENTRADA",
        userId: "user-1",
      })
    );
    // Botões do passo seguinte (oficial): Pausa + Saída — o texto da
    // confirmação vive no body do payload interativo.
    const last = interactive.at(-1) as {
      action: { buttons: { reply: { id: string } }[] };
      body: { text: string };
      type: string;
    };
    expect(last.type).toBe("button");
    expect(last.body.text).toContain("Entrada");
    expect(last.action.buttons.map((b) => b.reply.id)).toEqual([
      "ponto_pausa",
      "ponto_saida",
    ]);
    expect(sent).toHaveLength(0);
  });

  it("evaluate RECUSADO → resposta com motivo, sem registo", async () => {
    cloudOk("RECUSADO", { reason: "fora do raio" });
    const { ctx, interactive, phone, sent, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA loja-x 4821" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 40.6, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    // RECUSADO não tem botões → confirmação vai em texto simples.
    expect(sent.at(-1) ?? lastInteractiveText(interactive)).toContain(
      "fora do raio"
    );
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });

  it("evaluate indisponível → erro amigável, sem registo", async () => {
    mocks.cloudFetch.mockResolvedValue({ body: null, ok: false, status: 500 });
    const { ctx, phone, sent, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA loja-x 4821" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(sent.at(-1)).toContain("Não consegui");
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });
});

describe("fluxo PAUSA/VOLTEI/SAIDA", () => {
  const entradaToday = () => [
    {
      at: new Date(Date.now() - 4 * 3_600_000),
      status: "APROVADO",
      type: "ENTRADA",
    },
  ];

  it("PAUSA sem entrada hoje → 'Não tem entrada registada hoje'", async () => {
    const { ctx, phone, sent, t } = setup();
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(ctx, msg({ fromPhone: phone, text: "PAUSA" }), t);
    expect(sent[0]).toContain("Não tem entrada registada hoje");
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("PAUSA com entrada → pending → localização → registo PAUSA", async () => {
    const { ctx, interactive, phone, sent, t } = setup();
    mocks.todayPontoEntries.mockResolvedValue(entradaToday());
    cloudOk("POR_VALIDAR", { reason: "localização imprecisa" });
    await tryHandlePontoStaff(ctx, msg({ fromPhone: phone, text: "PAUSA" }), t);
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(evaluateBody()).toMatchObject({
      hasPhoto: false,
      type: "PAUSA",
    });
    expect(evaluateBody().todayHasEntry).toBeUndefined();
    expect(mocks.recordPontoEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "POR_VALIDAR", type: "PAUSA" })
    );
    // POR_VALIDAR não tem botões de continuação → texto simples… ou o
    // hint VOLTEI vai em interativo? Verifica ambos.
    const text = sent.at(-1) ?? lastInteractiveText(interactive);
    expect(text).toContain("pendente de validação");
  });

  it("ENTRADA durante pausa → regista VOLTEI com '(pausa de N min)'", async () => {
    const { ctx, interactive, phone, t } = setup();
    const pausaAt = new Date(Date.now() - 11 * 60_000);
    mocks.todayPontoEntries.mockResolvedValue([
      {
        at: new Date(Date.now() - 3 * 3_600_000),
        status: "APROVADO",
        type: "ENTRADA",
      },
      { at: pausaAt, status: "APROVADO", type: "PAUSA" },
    ]);
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA loja-x 9999" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(evaluateBody()).toMatchObject({ type: "VOLTEI" });
    expect(evaluateBody().code).toBeUndefined();
    const text = lastInteractiveText(interactive);
    expect(text).toContain("Regresso");
    expect(text).toContain("pausa de 11 min");
  });

  it("segunda localização no mesmo pedido não volta a avaliar (dedupe)", async () => {
    const { ctx, phone, sent, t } = setup();
    mocks.todayPontoEntries.mockResolvedValue([
      {
        at: new Date(Date.now() - 4 * 3_600_000),
        status: "APROVADO",
        type: "ENTRADA",
      },
    ]);
    await tryHandlePontoStaff(ctx, msg({ fromPhone: phone, text: "PAUSA" }), t);
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    const evaluateCalls = () =>
      mocks.cloudFetch.mock.calls.filter((c) => c[1] === "/ponto/evaluate")
        .length;
    expect(evaluateCalls()).toBe(1);
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    // O pedido morreu com a primeira localização — a segunda partilha
    // é uma localização órfã, nunca uma segunda PAUSA.
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.73, lng: -9.15 },
        messageType: "location",
      }),
      t
    );
    expect(evaluateCalls()).toBe(1);
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toContain("localização");
  });
});

describe("pedidos pendentes e TTL", () => {
  it("localização fora do pedido → aviso, sem evaluate", async () => {
    const { ctx, phone, sent, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 1, lng: 1 },
        messageType: "location",
      }),
      t
    );
    expect(sent[0]).toContain("localização");
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("pedido de localização expira aos 3 min", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T08:00:00Z"));
    const { ctx, phone, sent, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date().toISOString(),
        fromPhone: phone,
        text: "ENTRADA loja-x 4821",
      }),
      t
    );
    vi.setSystemTime(new Date("2026-01-10T08:04:00Z"));
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date().toISOString(),
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("expirou");
  });

  it("texto novo substitui pendente de localização", async () => {
    const { ctx, phone, sent, t } = setup();
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA loja-x 4821" }),
      t
    );
    await tryHandlePontoStaff(ctx, msg({ fromPhone: phone, text: "PAUSA" }), t);
    expect(sent.at(-1)).toContain("Não tem entrada registada hoje");
    // O pendente de localização foi substituído — uma localização a
    // seguir não completa nada.
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });
});

describe("SMS", () => {
  function smsTransport() {
    const sent: string[] = [];
    const t: InboundTransport = {
      channelLabel: "SMS",
      ponto: { transport: "sms" },
      send: vi.fn((text: string) => {
        sent.push(text);
        return Promise.resolve(true);
      }),
    };
    return { sent, t };
  }

  it("staff sem pontoSmsAllowed → 'Use o WhatsApp', sem registo", async () => {
    const { ctx, phone } = setup();
    const { sent, t } = smsTransport();
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA 4821" }),
      t
    );
    expect(handled).toBe(true);
    expect(sent[0]).toContain("Use o WhatsApp");
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
  });

  it("staff com pontoSmsAllowed → evaluate direto, transport=sms", async () => {
    const phone = nextPhone();
    const staff = staffUserFor(phone, { pontoSmsAllowed: true });
    const prisma = makePrisma([staff]);
    const ctx = makeCtx(prisma);
    cloudOk("POR_VALIDAR");
    const { sent, t } = smsTransport();
    const handled = await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA 4821" }),
      t
    );
    expect(handled).toBe(true);
    expect(evaluateBody()).toMatchObject({
      code: "4821",
      transport: "sms",
      type: "ENTRADA",
    });
    expect(evaluateBody().location).toBeUndefined();
    expect(mocks.recordPontoEntry).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ status: "POR_VALIDAR", transport: "SMS" })
    );
    expect(sent.at(-1) ?? "").toContain("pendente de validação");
  });
});

describe("externos (externalWork)", () => {
  it("ENTRADA sem código → localização → pedido de foto → foto → hasPhoto", async () => {
    const { ctx, phone, sent, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    expect(sent.at(-1)).toContain("foto");
    // Ainda não avaliou — espera a foto.
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
    ]);
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        imageRef: { mimetype: "image/png", raw: { key: { id: "k" } } },
        messageType: "image",
      }),
      t,
      { fetchPhoto: async () => ({ buffer: png, mimetype: "image/png" }) }
    );
    expect(evaluateBody()).toMatchObject({ hasPhoto: true, type: "ENTRADA" });
    expect(mocks.savePontoPhotoFile).toHaveBeenCalled();
    expect(mocks.linkPontoPhoto).toHaveBeenCalledWith(
      expect.anything(),
      "photo-1",
      "entry-1"
    );
    expect(mocks.recordPontoEntry).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proofs: expect.objectContaining({ hasPhoto: true, photoId: "photo-1" }),
      })
    );
  });

  it("foto a tempo >5 min depois do comando → messageAt é o envio da foto, não o comando", async () => {
    // Regressão: o messageAt do comando somava comando+localização+
    // foto (janelas da app, 3+5 min) e ultrapassava o corte de 5 min
    // da Cloud mesmo com o funcionário a responder sempre a tempo —
    // uma entrada aprovável caía em POR_VALIDAR «recebido com atraso».
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T09:00:00Z"));
    const { ctx, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    const commandAt = "2026-01-10T09:00:00.000Z";
    await tryHandlePontoStaff(
      ctx,
      msg({ createdAt: commandAt, fromPhone: phone, text: "ENTRADA" }),
      t
    );
    vi.setSystemTime(new Date("2026-01-10T09:02:30.000Z"));
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: "2026-01-10T09:02:30.000Z",
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    // Foto chega 6 min depois do comando — dentro da janela da foto.
    vi.setSystemTime(new Date("2026-01-10T09:06:00Z"));
    const photoAt = new Date().toISOString();
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
    ]);
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: photoAt,
        fromPhone: phone,
        imageRef: { mimetype: "image/png", raw: { key: { id: "k" } } },
        messageType: "image",
      }),
      t,
      { fetchPhoto: async () => ({ buffer: png, mimetype: "image/png" }) }
    );
    const body = evaluateBody();
    expect(body).toMatchObject({ hasPhoto: true, type: "ENTRADA" });
    // messageAt = envio da foto — fresco na janela de 5 min da Cloud.
    expect(body.messageAt).toBe(photoAt);
    expect(Date.now() - Date.parse(body.messageAt as string)).toBeLessThan(
      5 * 60 * 1000
    );
  });

  it("foto não chega em 5 min → regista com hasPhoto=false", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T09:00:00Z"));
    const { ctx, interactive, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    const now = new Date().toISOString();
    await tryHandlePontoStaff(
      ctx,
      msg({ createdAt: now, fromPhone: phone, text: "ENTRADA" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date().toISOString(),
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    vi.setSystemTime(new Date("2026-01-10T09:06:00Z"));
    // Qualquer mensagem seguinte finaliza o pendente expirado.
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date().toISOString(),
        fromPhone: phone,
        text: "obrigado",
      }),
      t
    );
    expect(evaluateBody()).toMatchObject({ hasPhoto: false });
    expect(mocks.recordPontoEntry).toHaveBeenCalled();
    const text = lastInteractiveText(interactive);
    expect(text).toContain("Entrada");
  });

  it("foto não chega → o timer do TTL finaliza sozinho, sem mensagem nova", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T09:00:00Z"));
    const { ctx, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date().toISOString(),
        fromPhone: phone,
        text: "ENTRADA",
      }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: new Date().toISOString(),
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    // Nenhum inbound a seguir — só o relógio anda. O timer agendado ao
    // entrar na etapa de foto tem de finalizar com hasPhoto=false.
    await vi.advanceTimersByTimeAsync(PONTO_PHOTO_TTL_MS + 1000);
    expect(evaluateBody()).toMatchObject({ hasPhoto: false });
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    // E não repete: o pendente foi consumido uma única vez.
    await vi.advanceTimersByTimeAsync(PONTO_PHOTO_TTL_MS * 2);
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
  });

  it("foto não chega → messageAt é o fecho da janela da foto, não o comando", async () => {
    // Regressão ronda 2: messageAt=commandAt fazia now-messageAt>5 min
    // na Cloud (comando + espera de foto ≥ TTL) → "registo recebido com
    // atraso" em vez de "foto em falta"/APROVADO. A marcação fica final
    // quando a janela da foto fecha — é daí que a frescura se mede.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T09:00:00Z"));
    const { ctx, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    const commandAt = "2026-01-10T09:00:00.000Z";
    await tryHandlePontoStaff(
      ctx,
      msg({ createdAt: commandAt, fromPhone: phone, text: "ENTRADA" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: commandAt,
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    await vi.advanceTimersByTimeAsync(PONTO_PHOTO_TTL_MS + 1000);
    const body = evaluateBody();
    expect(body).toMatchObject({ hasPhoto: false, type: "ENTRADA" });
    const messageAt = Date.parse(body.messageAt as string);
    expect(Number.isFinite(messageAt)).toBe(true);
    expect(body.messageAt).not.toBe(commandAt);
    // Fresca para a janela de 5 min da Cloud (≈1 s depois do fecho).
    expect(Date.now() - messageAt).toBeLessThanOrEqual(5000);
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
  });

  it("foto pendente expira e o funcionário só aparece horas depois → messageAt velho (atraso real)", async () => {
    // O fecho da janela é o messageAt — se a prova é genuinamente velha
    // (o funcionário desapareceu), a Cloud continua a ver o atraso.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T09:00:00Z"));
    const { ctx, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: "2026-01-10T09:00:00.000Z",
        fromPhone: phone,
        text: "ENTRADA",
      }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: "2026-01-10T09:00:00.000Z",
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    // 3 h depois uma mensagem nova encontra o pendente expirado — a
    // janela da foto fechou às 09:05:00 e é esse o instante reportado.
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: "2026-01-10T12:00:00.000Z",
        fromPhone: phone,
        text: "obrigado",
      }),
      t
    );
    expect(evaluateBody().messageAt).toBe("2026-01-10T09:05:00.000Z");
  });

  it("foto que não grava (imagem inválida) → hasPhoto=false, sem photoId", async () => {
    const { ctx, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    // A foto chega mas a gravação rejeita-a (magic bytes inválidos) —
    // a marcação segue sem prova, nunca APROVADO com foto fantasma.
    mocks.savePontoPhotoFile.mockResolvedValueOnce(null);
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        imageRef: { mimetype: "image/png", raw: { key: { id: "k" } } },
        messageType: "image",
      }),
      t,
      {
        fetchPhoto: async () => ({
          buffer: Buffer.from("isto nao e uma imagem"),
          mimetype: "image/png",
        }),
      }
    );
    expect(evaluateBody()).toMatchObject({ hasPhoto: false });
    const entryArg = mocks.recordPontoEntry.mock.calls.at(-1)?.[1] as
      | { proofs: Record<string, unknown> }
      | undefined;
    expect(entryArg?.proofs.hasPhoto).toBe(false);
    expect(entryArg?.proofs.photoId).toBeUndefined();
    expect(mocks.linkPontoPhoto).not.toHaveBeenCalled();
  });

  it("URL de foto privada (SSRF) → descartada sem download, hasPhoto=false", async () => {
    const { ctx, phone, t } = setup({
      staffOver: { externalWork: true },
    });
    mocks.todayPontoEntries.mockResolvedValue([]);
    await tryHandlePontoStaff(
      ctx,
      msg({ fromPhone: phone, text: "ENTRADA" }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 41.1, lng: -8.6 },
        messageType: "location",
      }),
      t
    );
    // Sem opts.fetchPhoto → defaultFetchPhoto → a url do webhook passa
    // pela guarda SSRF: IP privado/link-local nunca é contactado.
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        imageRef: {
          mimetype: "image/png",
          url: "https://169.254.169.254/latest/meta-data",
        },
        messageType: "image",
      }),
      t
    );
    expect(evaluateBody()).toMatchObject({ hasPhoto: false });
    expect(mocks.savePontoPhotoFile).not.toHaveBeenCalled();
  });
});

describe("separação staff ↔ clientes (handleInboundMessage)", () => {
  it("telefone de staff nunca chega a composeReply nem à inbox", async () => {
    const { ctx, phone, t } = setup();
    const out = await handleInboundMessage(
      ctx,
      msg({ fromPhone: phone, text: "PAUSA" }),
      t
    );
    expect(out?.sent).toBe(true);
    // Sem entrada hoje → resposta ponto; se tivesse caído no pipeline de
    // clientes, customer.findMany/job.findMany teriam sido consultados.
    const prisma = ctx.prisma as unknown as ReturnType<typeof makePrisma>;
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("cliente a escrever ENTRADA → bot normal (ponto devolve false)", async () => {
    const prisma = makePrisma([]); // sem staff
    const { t } = makeTransport();
    const ctx = makeCtx(prisma);
    const customerPhone = nextPhone();
    // Com t.ponto mas remetente desconhecido → cai no pipeline de
    // clientes (sem cliente → resposta de escalada/vazio, mas o ponto
    // não consumiu nem avaliou).
    const out = await handleInboundMessage(
      ctx,
      msg({ fromPhone: customerPhone, text: "ENTRADA" }),
      t
    );
    expect(out).not.toBeNull();
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });

  it("PARAR de número dual-role (staff+cliente) → ponto responde E consentimento revoga", async () => {
    const phone = nextPhone();
    const staff = staffUserFor(phone);
    const customer = { id: "cust-1", name: "Rui", phone: `+${phone}` };
    const prisma = makePrisma([staff], [customer]);
    const ctx = makeCtx(prisma);
    const { sent, t } = makeTransport();
    const out = await handleInboundMessage(
      ctx,
      msg({ fromPhone: phone, text: "PARAR" }),
      t
    );
    expect(out?.sent).toBe(true);
    // O ponto consumiu a mensagem (lista de comandos)…
    expect(sent[0]).toContain("Comandos");
    // …mas a revogação de consentimento corre na mesma — sem ela os
    // avisos automáticos continuavam autorizados.
    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: { whatsappConsent: false, whatsappConsentAt: null },
      where: { id: "cust-1" },
    });
    // E nunca chegou ao pipeline de clientes.
    expect(prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("sentAt da fila oficial propaga-se como messageAt no evaluate", async () => {
    const sentAt = "2026-01-10T08:00:00.000Z";
    const { ctx, phone, t } = setup();
    await tryHandlePontoStaff(
      ctx,
      msg({
        createdAt: "2026-01-10T08:05:00.000Z", // receção 5 min depois
        fromPhone: phone,
        sentAt,
        text: "ENTRADA loja-x 4821",
      }),
      t
    );
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    // A Cloud mede a validade do código ao ENVIO (Meta), não à receção.
    expect(evaluateBody().messageAt).toBe(sentAt);
  });
});

describe("canal Evolution", () => {
  it("sem interactive → pedidos em texto e confirmação com hint", async () => {
    const { ctx, phone } = setup();
    mocks.todayPontoEntries.mockResolvedValue([
      {
        at: new Date(Date.now() - 2 * 3_600_000),
        status: "APROVADO",
        type: "ENTRADA",
      },
    ]);
    const sent: string[] = [];
    const t: InboundTransport = {
      channelLabel: "WhatsApp",
      ponto: { transport: "whatsapp_evolution" },
      send: vi.fn((text: string) => {
        sent.push(text);
        return Promise.resolve(true);
      }),
    };
    await tryHandlePontoStaff(ctx, msg({ fromPhone: phone, text: "PAUSA" }), t);
    expect(sent.at(-1)).toContain("Localização");
    await tryHandlePontoStaff(
      ctx,
      msg({
        fromPhone: phone,
        location: { lat: 38.72, lng: -9.14 },
        messageType: "location",
      }),
      t
    );
    expect(evaluateBody().transport).toBe("whatsapp_evolution");
    expect(sent.join(" ")).toContain("Responda VOLTEI");
  });
});
