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
  timeEntryFindMany: vi.fn(
    (_args?: unknown): Promise<unknown[]> => Promise.resolve([])
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
import { parsePontoExitAnswer } from "../exit-answer.js";
import { tryHandlePontoStaff, workedMs } from "../handler.js";
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
    timeEntry: {
      findFirst: mocks.timeEntryFindFirst,
      findMany: mocks.timeEntryFindMany,
    },
    user: { findMany: vi.fn(() => Promise.resolve([staff])) },
  };
  const sent: string[] = [];
  // ids determinísticos por envio — `sendWithId` é o que as perguntas
  // de seguimento do lembrete usam para registar a mensagem real.
  let sendSeq = 0;
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
    sendWithId: vi.fn((text: string) => {
      sent.push(text);
      sendSeq += 1;
      return Promise.resolve({
        messageId: `wamid-reply-${sendSeq}`,
        success: true,
      });
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

function armPending(
  userId = "user-1",
  shiftOpenAt?: string,
  sentMessageIds?: string[]
) {
  setPendingPontoExit(userId, {
    expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
    presumedAt: PRESUMED_AT.toISOString(),
    presumedEntryId: "presumed-1",
    ...(sentMessageIds ? { sentMessageIds } : {}),
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
  // Overrides por-teste (mockResolvedValue) sobrevivem ao
  // clearAllMocks — repor os defaults que os casos assumem.
  mocks.timeEntryFindFirst.mockResolvedValue(null);
  mocks.findOpenPresumedExit.mockResolvedValue(null);
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

  it("SIM depois de recusa do gestor → não grava correção e fecha o fluxo", async () => {
    // Segurança: a presumida foi recusada na validação — o «SIM» do
    // trabalhador não a pode substituir por uma correção APROVADO sem
    // nova decisão do gestor. O fluxo fecha e o acerto é no painel.
    const { ctx, message, sent, t } = setup();
    armPending();
    mocks.timeEntryFindFirst.mockImplementation((() =>
      Promise.resolve({
        id: "presumed-1",
        validations: [{ decision: "RECUSADO" }],
      })) as never);

    const handled = await tryHandlePontoStaff(ctx, message("SIM"), t);

    expect(handled).toBe(true);
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("recusada pela gerência");
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

  it('minutos separados por espaço depois do ponto ("18. 30") → 18:30', async () => {
    // O "." é o separador Horas.minutos de EXPLICIT_TIME_RE com
    // espaços — "18. 30" não pode ser partido como fim de frase.
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("Saí às 18. 30"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:30:00.000Z");
  });

  it("SIM citando a pergunta ativa → confirma a presumida", async () => {
    const { ctx, message, t } = setup();
    armPending("user-1", undefined, ["wamid-pergunta-2"]);

    await tryHandlePontoStaff(
      ctx,
      { ...message("SIM"), quotedMessageId: "wamid-pergunta-2" },
      t
    );

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "APROVADO", type: "SAIDA" });
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("SIM citando um lembrete antigo → não confirma a saída do turno errado", async () => {
    // Dois lembretes no mesmo chat (saiu 18:00, voltou a entrar 19:00):
    // a citação aponta para a pergunta velha mas o pending só conhece
    // a ativa — a confirmação não se grava e a pergunta ativa repete-se.
    const { ctx, message, sent, t } = setup();
    armPending("user-1", undefined, ["wamid-pergunta-2"]);

    await tryHandlePontoStaff(
      ctx,
      { ...message("SIM"), quotedMessageId: "wamid-pergunta-1" },
      t
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("Saiu às 18:00");
    const pending = getPendingPontoExit("user-1");
    expect(pending).not.toBeNull();
    // A repetição da pergunta foi enviada com sendWithId — o id novo
    // associa-se à pendência para a próxima citação contar.
    expect(pending?.sentMessageIds).toEqual([
      "wamid-pergunta-2",
      "wamid-reply-1",
    ]);
  });

  it("SIM citando a repetição da pergunta → confirma a presumida", async () => {
    // O trabalhador citou a REPETIÇÃO («Saiu às 18:00?» reenviada) —
    // o pending já conhece o id dessa pergunta e a resposta conta.
    const { ctx, message, t } = setup();
    armPending("user-1", undefined, ["wamid-pergunta-2", "wamid-reply-1"]);

    await tryHandlePontoStaff(
      ctx,
      { ...message("SIM"), quotedMessageId: "wamid-reply-1" },
      t
    );

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "APROVADO", type: "SAIDA" });
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("citação sem id de envio registado → resposta segue o fluxo normal", async () => {
    // Canal que não devolve o id da mensagem (SMS, relay cloud): a
    // citação não é verificável — a resposta aplica-se à pendente.
    const { ctx, message, t } = setup();
    armPending(); // sem sentMessageIds

    await tryHandlePontoStaff(
      ctx,
      { ...message("SIM"), quotedMessageId: "qualquer-id" },
      t
    );

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
  });

  it("negação noutra frase não apaga a hora afirmada", async () => {
    // "Saí às 18:20. Não consegui responder antes" — o ponto a seguir a
    // um dígito separa as frases na mesma; a negação governa só a
    // segunda e as 18:20 gravam-se.
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(
      ctx,
      message("Saí às 18:20. Não consegui responder antes"),
      t
    );

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:20:00.000Z");
  });

  it('"Saí 18:05" com pending → correção na hora declarada (não comando SAIDA)', async () => {
    // O parser de comandos lia "Saí 18:05" como SAIDA e a hora
    // declarada perdia-se — com pergunta pendente a declaração COM
    // hora responde à pergunta.
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("Saí 18:05"), t);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
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
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:05:00.000Z");
    // Não passou pelo evaluate da Cloud — é a correção direta.
    expect(mocks.cloudFetch).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("SAIDA com horas ambíguas (SMS) → repete a pergunta, pending vivo", async () => {
    // «Saí 18:05-19» traz duas horas candidatas: é tentativa de
    // resposta ao lembrete, não comando sem hora — sem o desvio o
    // fluxo de comando gravava a hora de receção e limpava o pending.
    const { ctx, message, sent, t } = setup({
      smsAllowed: true,
      transport: "sms",
    });
    armPending();
    // O parser devolve mesmo «ambiguous» — o desvio não depende só
    // de haver dígitos (senão testaria-se a rota errada).
    expect(parsePontoExitAnswer("Saí 18:05-19")).toEqual({
      kind: "ambiguous",
    });

    await tryHandlePontoStaff(ctx, message("Saí 18:05-19"), t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1")).not.toBeNull();
    expect(sent.at(-1)).toContain("escreva a hora de saída");
    // SAÍDA sem hora continua comando normal — mata o pending.
    await tryHandlePontoStaff(ctx, message("SAIDA"), t);
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("SAIDA com datas ambíguas (SMS) → o ano não é código, repete a pergunta", async () => {
    // «09/01/2026 ou 10/01/2026» — o token de 4 dígitos é um ano,
    // não código QR: sem o desvio o comando gravava a hora de
    // receção e limpava o pending.
    const { ctx, message, sent, t } = setup({
      smsAllowed: true,
      transport: "sms",
    });
    armPending();

    await tryHandlePontoStaff(
      ctx,
      message("Saí às 18:05 em 09/01/2026 ou 10/01/2026"),
      t
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1")).not.toBeNull();
    expect(sent.at(-1)).toContain("escreva a hora de saída");
  });

  it("botão SAIDA com pending → comando ganha (pending morre, fluxo normal)", async () => {
    // Botões/IDs interativos são autoridade — nunca desviados para a
    // resposta do lembrete mesmo com hora no texto.
    const { ctx, message, t } = setup({ smsAllowed: true, transport: "sms" });
    armPending();
    mocks.findOpenPresumedExit.mockResolvedValue({
      at: PRESUMED_AT,
      id: "presumed-1",
    });
    const msg = { ...message("Saí 18:05"), interactiveId: "ponto_saida" };

    await tryHandlePontoStaff(ctx, msg, t);

    expect(getPendingPontoExit("user-1")).toBeNull();
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    // Caminho do comando: hora da mensagem (18:30), razão de registo
    // manual — não a hora declarada do exit-answer.
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:30:00.000Z");
    expect(entry.reason).toBe("saída registada pelo trabalhador");
  });

  it("«Saí 23/11 18:05» por SMS com pending → data de outro dia repete a pergunta", async () => {
    // A data declarada (23 de novembro) não é nenhum dos dias
    // candidatos do turno (10 e 11 de janeiro): a resposta não é
    // sobre este lembrete — repete-se a pergunta sem gravar 18:05
    // no dia errado nem limpar o pending.
    const { ctx, message, sent, t } = setup({
      smsAllowed: true,
      transport: "sms",
    });
    armPending();

    await tryHandlePontoStaff(ctx, message("Saí 23/11 18:05"), t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("escreva a hora de saída");
    expect(getPendingPontoExit("user-1")).not.toBeNull();
  });

  it("«Saí 10/1 18:05» com pending → data bate no turno e grava 18:05", async () => {
    // O mesmo formato com a data do próprio turno: «10/1» é o dia
    // da presumida — a hora declarada grava-se nesse dia.
    const { ctx, message, t } = setup({
      smsAllowed: true,
      transport: "sms",
    });
    armPending();

    await tryHandlePontoStaff(ctx, message("Saí 10/1 18:05"), t);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
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
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:05:00.000Z");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("«ontem às 18:05» no próprio dia do turno → repete a pergunta, não grava no dia errado", async () => {
    // Regressão: a palavra «ontem» perdia-se e as 18:05 gravavam-se no
    // dia da presumida — o trabalhador disse ONTEM e o livro marcava
    // HOJE. Ontem não é candidato deste turno → pergunta outra vez.
    const { ctx, message, sent, t } = setup({
      smsAllowed: true,
      transport: "sms",
    });
    armPending();

    await tryHandlePontoStaff(ctx, message("ontem às 18:05"), t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("escreva a hora de saída");
    expect(getPendingPontoExit("user-1")).not.toBeNull();
  });

  it("«ontem às 18:05» respondido depois da meia-noite → grava no dia da presumida", async () => {
    // Lembrete das 23:30 respondido às 00:20 — «ontem» É o dia da
    // presumida: a palavra resolve para o dia certo e grava 18:05 lá.
    const { ctx, message, t } = setup({
      smsAllowed: true,
      transport: "sms",
    });
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      shiftOpenAt: "2026-01-10T16:00:00.000Z",
      userId: "user-1",
    });
    const msg = {
      ...message("ontem às 18:05"),
      createdAt: "2026-01-11T00:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T18:05:00.000Z");
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

  it("resposta depois da meia-noite com data declarada aceita o dia seguinte", async () => {
    // «Saí a 11/1 às 00:15» — a data declarada é o dia civil seguinte
    // ao da presumida: bate no segundo dia candidato e a correção
    // grava-se nesse dia.
    const { ctx, message, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      shiftOpenAt: "2026-01-10T16:00:00.000Z",
      userId: "user-1",
    });
    const msg = {
      ...message("Saí a 11/1 às 00:15"),
      createdAt: "2026-01-11T00:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-11T00:15:00.000Z");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("hora com zero inicial ('01:15') depois da meia-noite fica na madrugada", async () => {
    // "01:15" é 24 h inequívoca — a heurística da tarde só cobre as
    // formas ambíguas ("1:15", "saí às 7").
    const { ctx, message, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:45:00.000Z",
      presumedEntryId: "presumed-1",
      shiftOpenAt: "2026-01-10T16:00:00.000Z",
      userId: "user-1",
    });
    const msg = {
      ...message("01:15"),
      createdAt: "2026-01-11T01:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-11T01:15:00.000Z");
  });

  it("resposta pós-meia-noite na véspera da hora de verão grava no dia seguinte", async () => {
    // Lisboa, 29-03-2026: o relógio salta 01:00→02:00 — o dia civil tem
    // 23 h. Somar 24 h à presumida saltava para 30-03; o dia seguinte
    // real é o início do dia civil seguinte.
    const { ctx, message, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-03-28T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      shiftOpenAt: "2026-03-28T16:00:00.000Z",
      userId: "user-1",
    });
    const msg = {
      ...message("00:15"),
      createdAt: "2026-03-29T00:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-03-29T00:15:00.000Z");
  });

  it("«VOLTEI 18:05» com pending → fluxo VOLTEI normal, não correção de saída", async () => {
    // O parser de comandos aceita o sufixo numérico e o exit-answer lia
    // a hora — sem o gate SAIDA o regresso da pausa gravava uma SAIDA
    // POR_VALIDAR e o regresso nunca acontecia.
    const { ctx, message, t } = setup();
    armPending();

    await tryHandlePontoStaff(ctx, message("VOLTEI 18:05"), t);

    // Sem correção de saída; o comando mata o pending e segue o fluxo
    // normal de marcação (pedido de localização do VOLTEI).
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1")).toBeNull();
    expect(t.ponto?.interactive).toHaveBeenCalled();
  });

  it("com clarifyDate pendente, «SIM»/«Certo» repete a pergunta sem gravar", async () => {
    // «SIM» responde à pergunta ERRADA (a anterior, SIM/hora) — com a
    // escolha do dia pendente não pode aprovar a presumida nem descartar
    // a hora declarada. O pending fica vivo com clarifyDate intacto.
    const { ctx, message, sent, t } = setup();
    setPendingPontoExit("user-1", {
      clarifyDate: {
        hhmm: "00:15",
        ymdReminder: "2026-01-10",
        ymdReply: "2026-01-11",
      },
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      userId: "user-1",
    });
    const msg = { ...message(""), createdAt: "2026-01-11T00:25:00.000Z" };

    await tryHandlePontoStaff(ctx, { ...msg, text: "SIM" }, t);
    await tryHandlePontoStaff(ctx, { ...msg, text: "Certo" }, t);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("Responda ONTEM ou HOJE");
    const pending = getPendingPontoExit("user-1");
    expect(pending?.clarifyDate?.hhmm).toBe("00:15");
  });

  it("com clarifyDate pendente, uma nova hora explícita reabre o cálculo", async () => {
    // O trabalhador pode corrigir a hora em vez de escolher o dia —
    // "saí às 22:15" só é plausível no dia do lembrete (no dia da
    // resposta estaria no futuro) → grava sem nova pergunta.
    const { ctx, message, t } = setup();
    setPendingPontoExit("user-1", {
      clarifyDate: {
        hhmm: "00:15",
        ymdReminder: "2026-01-10",
        ymdReply: "2026-01-11",
      },
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      userId: "user-1",
    });
    const msg = {
      ...message("saí às 22:15"),
      createdAt: "2026-01-11T00:25:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry).toMatchObject({ status: "POR_VALIDAR", type: "SAIDA" });
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T22:15:00.000Z");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("dois dias plausíveis → pergunta ONTEM/HOJE; a escolha grava", async () => {
    const { ctx, message, sent, t } = setup();
    // Pending antigo sem shiftOpenAt (armado antes da atualização):
    // sem o limite do turno, "00:15" serve para os dois dias — a app
    // pergunta o dia em vez de gravar uma data arbitrária.
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
    expect(sent.at(-1)).toContain("ONTEM ou HOJE");
    expect(getPendingPontoExit("user-1")?.clarifyDate).toMatchObject({
      hhmm: "00:15",
      ymdReply: "2026-01-11",
      ymdReminder: "2026-01-10",
    });

    // "HOJE" → grava no dia da resposta; pending morre.
    await tryHandlePontoStaff(ctx, message("HOJE"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((entry.at as Date).toISOString()).toBe("2026-01-11T00:15:00.000Z");
    expect(entry.status).toBe("POR_VALIDAR");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("«ONTEM» citando a pergunta de clarificação → grava no dia do lembrete", async () => {
    // A pergunta ONTEM/HOJE saiu por sendWithId — o id vai para a
    // pendência e a citação da resposta a essa mensagem conta (antes
    // só o id do lembrete inicial era aceite e a escolha era rejeitada).
    const { ctx, message, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      sentMessageIds: ["wamid-pergunta-2"],
      userId: "user-1",
    });
    const msg = {
      ...message("00:15"),
      createdAt: "2026-01-11T00:20:00.000Z",
    };

    await tryHandlePontoStaff(ctx, msg, t);

    // Clarificação armada + a pergunta enviada registou o seu id.
    const pending = getPendingPontoExit("user-1");
    expect(pending?.clarifyDate?.hhmm).toBe("00:15");
    expect(pending?.sentMessageIds).toEqual([
      "wamid-pergunta-2",
      "wamid-reply-1",
    ]);

    await tryHandlePontoStaff(
      ctx,
      { ...message("ONTEM"), quotedMessageId: "wamid-reply-1" },
      t
    );

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T00:15:00.000Z");
    expect(entry.status).toBe("POR_VALIDAR");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("«ONTEM» citando uma pergunta substituída reenvia a atual sem gravar", async () => {
    // Duas horas ambíguas seguidas — a 2.ª clarificação substitui a
    // 1.ª e a pergunta nova ganha id próprio. A resposta citada à
    // pergunta das 00:15 não pode gravar a hora das 00:20: reenvia-se
    // a pergunta atual (que mostra 00:20) sem gravar nada.
    const { ctx, message, sent, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      userId: "user-1",
    });
    const at = (text: string) => ({
      ...message(text),
      createdAt: "2026-01-11T00:25:00.000Z",
    });

    await tryHandlePontoStaff(ctx, at("00:15"), t);
    await tryHandlePontoStaff(ctx, at("00:20"), t);

    const pending = getPendingPontoExit("user-1");
    // A clarificação ativa é a das 00:20 e já conhece os dois ids das
    // suas perguntas (a pergunta inicial e a da substituição ficaram
    // ligadas à 1.ª clarificação — a lista da ativa só tem a sua).
    expect(pending?.clarifyDate?.hhmm).toBe("00:20");
    expect(pending?.clarifyDate?.questionMessageIds).toEqual(["wamid-reply-2"]);

    // Citação à pergunta das 00:15 (substituída): repete a pergunta
    // atual com 00:20 — NÃO grava 00:20 em nome da pergunta das 00:15.
    await tryHandlePontoStaff(
      ctx,
      { ...at("ONTEM"), quotedMessageId: "wamid-reply-1" },
      t
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("ONTEM ou HOJE");
    expect(sent.at(-1)).toContain("00:20");
    expect(getPendingPontoExit("user-1")?.clarifyDate?.hhmm).toBe("00:20");

    // Citação à pergunta atual (00:20) → grava essa hora em ONTEM.
    await tryHandlePontoStaff(
      ctx,
      { ...at("ONTEM"), quotedMessageId: "wamid-reply-2" },
      t
    );

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T00:20:00.000Z");
    expect(entry.status).toBe("POR_VALIDAR");
    expect(getPendingPontoExit("user-1")).toBeNull();
  });

  it("pergunta em voo durante a substituição não se liga à hora nova", async () => {
    // Corrida: o sendWithId da pergunta das 00:15 ainda corria quando
    // «00:20» substituiu a clarificação. O id tem de ficar só em
    // sentMessageIds — ligá-lo à clarificação nova gravava 00:20 num
    // «ONTEM» citado à pergunta das 00:15.
    const { ctx, message, sent, t } = setup();
    setPendingPontoExit("user-1", {
      expiresAt: Date.now() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
      userId: "user-1",
    });
    const sendWithId = t.sendWithId as ReturnType<typeof vi.fn>;
    sendWithId.mockImplementationOnce((text: string) => {
      sent.push(text);
      // Emula a mensagem «00:20» a completar durante este envio: a
      // clarificação ativa já é a das 00:20 com a sua própria pergunta.
      const cur = getPendingPontoExit("user-1");
      if (cur) {
        setPendingPontoExit("user-1", {
          ...cur,
          clarifyDate: {
            hhmm: "00:20",
            questionMessageIds: ["wamid-reply-2"],
            ymdReminder: "2026-01-10",
            ymdReply: "2026-01-11",
          },
          sentMessageIds: [...(cur.sentMessageIds ?? []), "wamid-reply-2"],
        });
      }
      return Promise.resolve({
        messageId: "wamid-reply-1",
        success: true,
      });
    });
    const at = (text: string) => ({
      ...message(text),
      createdAt: "2026-01-11T00:25:00.000Z",
    });

    await tryHandlePontoStaff(ctx, at("00:15"), t);

    const pending = getPendingPontoExit("user-1");
    // O id da pergunta atrasada fica só na lista geral — a clarificação
    // das 00:20 fica com os ids que realmente a serviram.
    expect(pending?.clarifyDate?.hhmm).toBe("00:20");
    expect(pending?.clarifyDate?.questionMessageIds).toEqual(["wamid-reply-2"]);
    expect(pending?.sentMessageIds).toContain("wamid-reply-1");
    expect(pending?.sentMessageIds).toContain("wamid-reply-2");

    // Citação à pergunta atrasada (00:15): reenvia a pergunta atual
    // com 00:20 — não grava a hora que a pergunta citada não tinha.
    await tryHandlePontoStaff(
      ctx,
      { ...at("ONTEM"), quotedMessageId: "wamid-reply-1" },
      t
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("ONTEM ou HOJE");
    expect(sent.at(-1)).toContain("00:20");
  });

  it("«ONTEM» citada antes da pergunta substituta ter id → reenvia", async () => {
    // Janela de receção: «00:20» já substituiu a clarificação mas o
    // envio da pergunta nova ainda não devolveu o id —
    // `questionMessageIds` está vazio e a citação «ONTEM» não se pode
    // verificar. Reenvia-se a pergunta atual; gravar aqui aplicava
    // 00:20 à pergunta citada das 00:15.
    const { ctx, message, sent, t } = setup();
    armPending();
    const at = (text: string) => ({
      ...message(text),
      createdAt: "2026-01-11T00:25:00.000Z",
    });

    await tryHandlePontoStaff(ctx, at("00:15"), t);
    expect(
      getPendingPontoExit("user-1")?.clarifyDate?.questionMessageIds
    ).toEqual(["wamid-reply-1"]);

    // A 2.ª clarificação fica criada mas com a pergunta em voo (sem id).
    let resolveSend:
      | ((r: { messageId?: string; success: boolean }) => void)
      | undefined;
    const sendWithId = t.sendWithId as ReturnType<typeof vi.fn>;
    sendWithId.mockImplementationOnce((text: string) => {
      sent.push(text);
      return new Promise<{ messageId?: string; success: boolean }>(
        (resolve) => {
          resolveSend = resolve;
        }
      );
    });
    const second = tryHandlePontoStaff(ctx, at("00:20"), t);
    // Um tick macrotarefa deixa o handler armar a clarificação das
    // 00:20 e bloquear no envio diferido da pergunta.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    const mid = getPendingPontoExit("user-1");
    expect(mid?.clarifyDate?.hhmm).toBe("00:20");
    expect(mid?.clarifyDate?.questionMessageIds).toBeUndefined();

    // «ONTEM» citando a pergunta das 00:15 nessa janela: reenvia a
    // pergunta das 00:20 — não grava a hora nova na pergunta antiga.
    await tryHandlePontoStaff(
      ctx,
      { ...at("ONTEM"), quotedMessageId: "wamid-reply-1" },
      t
    );
    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(sent.at(-1)).toContain("00:20");

    resolveSend?.({ messageId: "wamid-reply-tardio", success: true });
    await second;
    // O id tardio é da pergunta das 00:20 — liga-se à clarificação das
    // 00:20 (a citação a ele passa a contar); o das 00:15 fica fora.
    const after = getPendingPontoExit("user-1");
    expect(after?.clarifyDate?.questionMessageIds).toContain(
      "wamid-reply-tardio"
    );
    expect(after?.clarifyDate?.questionMessageIds).not.toContain(
      "wamid-reply-1"
    );
    expect(after?.sentMessageIds).toContain("wamid-reply-tardio");

    // Citação ao id tardio — a pergunta era mesmo a das 00:20: grava.
    await tryHandlePontoStaff(
      ctx,
      { ...at("ONTEM"), quotedMessageId: "wamid-reply-tardio" },
      t
    );
    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((entry.at as Date).toISOString()).toBe("2026-01-10T00:20:00.000Z");
    expect(getPendingPontoExit("user-1")).toBeNull();
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
    mocks.timeEntryFindFirst.mockResolvedValue({
      id: "corr-1",
      validations: [],
    } as never);

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

  it("entrada depois da presumida → SAIDA fecha o turno novo, presumida fica por validar", async () => {
    const { ctx, message, t } = setup({ smsAllowed: true, transport: "sms" });
    mocks.findOpenPresumedExit.mockResolvedValue({
      at: PRESUMED_AT,
      id: "presumed-1",
    });
    // Reentrada às 18:04 — depois da presumida das 18:00.
    mocks.timeEntryFindMany.mockResolvedValue([
      { id: "entrada-2", validations: [] },
    ] as never);

    await tryHandlePontoStaff(ctx, message("SAIDA"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry.correctsId).toBeNull();
    expect(entry.type).toBe("SAIDA");
  });

  it("reentrada recusada e re-aprovada → turno novo conta (decisão mais recente)", async () => {
    // Regressão: com o filtro `none` na query a reentrada re-aprovada
    // ficava invisível (existia uma recusa no histórico) e a SAIDA
    // substituía a presumida do turno anterior — fundia os dois turnos.
    const { ctx, message, t } = setup({ smsAllowed: true, transport: "sms" });
    mocks.findOpenPresumedExit.mockResolvedValue({
      at: PRESUMED_AT,
      id: "presumed-1",
    });
    mocks.timeEntryFindMany.mockResolvedValue([
      { id: "entrada-2", validations: [{ decision: "APROVADO" }] },
    ]);

    await tryHandlePontoStaff(ctx, message("SAIDA"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry.correctsId).toBeNull();
    // A query tem de pedir a decisão MAIS RECENTE (desc, take 1) —
    // sem esta asserção o teste passava mesmo com ordenação errada.
    const q = mocks.timeEntryFindMany.mock.calls[0]?.[0] as unknown as {
      select: Record<string, unknown>;
    };
    expect(q.select).toMatchObject({
      validations: {
        orderBy: { at: "desc" },
        select: { decision: true },
        take: 1,
      },
    });
  });

  it("reentrada recusada (mais recente) não abre turno — SAIDA corrige a presumida", async () => {
    const { ctx, message, t } = setup({ smsAllowed: true, transport: "sms" });
    mocks.findOpenPresumedExit.mockResolvedValue({
      at: PRESUMED_AT,
      id: "presumed-1",
    });
    mocks.timeEntryFindMany.mockResolvedValue([
      { id: "entrada-2", validations: [{ decision: "RECUSADO" }] },
    ] as never);

    await tryHandlePontoStaff(ctx, message("SAIDA"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry.correctsId).toBe("presumed-1");
  });

  it("reentrada recusada pela gerência não abre turno — SAIDA corrige a presumida", async () => {
    const { ctx, message, t } = setup({ smsAllowed: true, transport: "sms" });
    mocks.findOpenPresumedExit.mockResolvedValue({
      at: PRESUMED_AT,
      id: "presumed-1",
    });
    // A entrada das 18:04 foi recusada na validação — na base de
    // dados real o filtro validations.none RECUSADO exclui-a da
    // procura. O mock emula esse filtro: só devolve a entrada quando
    // a query NÃO a exclui (comportamento antigo, errado).
    mocks.timeEntryFindFirst.mockImplementation(((args?: unknown) => {
      const where = (args as { where?: { validations?: unknown } } | undefined)
        ?.where;
      return Promise.resolve(where?.validations ? null : { id: "entrada-2" });
    }) as never);

    await tryHandlePontoStaff(ctx, message("SAIDA"), t);

    const entry = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(entry.correctsId).toBe("presumed-1");
  });
});

describe("workedMs — sem overnight (decisão do dono 2026-11-25)", () => {
  const NOW = new Date("2026-01-10T00:20:00.000Z"); // sábado 00:20 UTC

  it("fecho noutro dia civil nunca emparelha — corta no fim do dia da entrada", () => {
    // Entrada 16:00 sexta · saída 00:15 sábado (correção ao lembrete):
    // conta no SEU dia civil como qualquer registo — sexta fecha à
    // meia-noite (8h), sábado tem saída sem entrada.
    const ms = workedMs(
      [
        { at: new Date("2026-01-09T16:00:00.000Z"), type: "ENTRADA" },
        { at: new Date("2026-01-10T00:15:00.000Z"), type: "SAIDA" },
      ],
      TZ,
      NOW
    );

    expect(ms).toBe(8 * 3_600_000);
  });

  it("turno por fechar em dia passado conta até ao fim desse dia — como no painel", () => {
    const ms = workedMs(
      [{ at: new Date("2026-01-09T16:00:00.000Z"), type: "ENTRADA" }],
      TZ,
      NOW
    );

    expect(ms).toBe(8 * 3_600_000);
  });

  it("turno em curso hoje conta até agora, nunca além", () => {
    const ms = workedMs(
      [{ at: new Date("2026-01-09T23:00:00.000Z"), type: "ENTRADA" }],
      TZ,
      new Date("2026-01-09T23:45:00.000Z")
    );

    expect(ms).toBe(45 * 60_000);
  });

  it("turno fechado no próprio dia conta o intervalo exato", () => {
    const ms = workedMs(
      [
        { at: new Date("2026-01-09T09:00:00.000Z"), type: "ENTRADA" },
        { at: new Date("2026-01-09T18:30:00.000Z"), type: "SAIDA" },
      ],
      TZ,
      NOW
    );

    expect(ms).toBe(9 * 3_600_000 + 30 * 60_000);
  });
});
