import { beforeEach, describe, expect, it, vi } from "vitest";

// Scheduler do livro de ponto (item 5 + §2.2b): tick de 15 min que
// cria a SAIDA presumida à pontoExitReminderTime, envia o lembrete
// pelo canal do ponto e alerta os gestores passado 60 min sem
// correção. Canais e envio são mocks — o estado (state.ts) corre a
// valer para verificar o pending awaitingExit.

const mocks = vi.hoisted(() => ({
  findManyUsers: vi.fn(() => Promise.resolve([{ id: "mgr-1" }])),
  findShopSettingsUnique: vi.fn(),
  getSmsConfig: vi.fn(),
  notify: vi.fn((_app: unknown, _event: unknown) => Promise.resolve()),
  recordPontoEntry: vi.fn((_prisma: unknown, _input: Record<string, unknown>) =>
    Promise.resolve({ id: "presumed-1" })
  ),
  resolveWhatsAppChannel: vi.fn(),
  sendSms: vi.fn((_config: unknown, _to: string, _text: string) =>
    Promise.resolve({ success: true })
  ),
  sendSmsViaCloud: vi.fn((_creds: unknown, _input: Record<string, unknown>) =>
    Promise.resolve({ success: true })
  ),
  sendWhatsAppTemplateVia: vi.fn(
    (
      _prisma: unknown,
      _channel: unknown,
      _to: string,
      _name: string,
      _lang: string,
      _params: string[]
    ) => Promise.resolve({ success: true })
  ),
  sendWhatsAppText: vi.fn(
    (_prisma: unknown, _channel: unknown, _to: string, _msg: string) =>
      Promise.resolve({ success: true })
  ),
  timeEntryFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock("../../../repositories/settings.repository.js", () => ({
  findShopSettingsUnique: mocks.findShopSettingsUnique,
}));
vi.mock("../../../repositories/notification.repository.js", () => ({
  findManyUsers: mocks.findManyUsers,
}));
vi.mock("../../notification-dispatch.js", () => ({ notify: mocks.notify }));
vi.mock("../../notification-outbox.service.js", () => ({
  getSmsConfig: mocks.getSmsConfig,
}));
vi.mock("../../sms-cloud.service.js", () => ({
  isDefinitiveCloudError: (e?: string) => e === "INVALID_BODY",
  sendSmsViaCloud: mocks.sendSmsViaCloud,
}));
vi.mock("../../sms.service.js", () => ({ sendSms: mocks.sendSms }));
vi.mock("../../whatsapp-channel.js", () => ({
  resolveWhatsAppChannel: mocks.resolveWhatsAppChannel,
  sendWhatsAppTemplateVia: mocks.sendWhatsAppTemplateVia,
  sendWhatsAppText: mocks.sendWhatsAppText,
}));
vi.mock("../../whatsapp-templates.service.js", () => ({
  TEMPLATE_LANG: "pt_PT",
}));
vi.mock("../entries.js", () => ({ recordPontoEntry: mocks.recordPontoEntry }));

import type { DbClient } from "../../../repositories/types.js";
import { clearPontoReminderState, processPontoReminders } from "../reminder.js";
import { clearAllPendingPonto, getPendingPontoExit } from "../state.js";

const TZ = "Europe/Lisbon";
// Sábado 10-01-2026: Lisboa = UTC+0. Lembrete às 18:00 → 18:00Z.
const NOW_AFTER = new Date("2026-01-10T18:30:00.000Z"); // 18:30 Lisboa
const REMINDER_AT = new Date("2026-01-10T18:00:00.000Z");

const log = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
} as never;

function makeSettings(over: Record<string, unknown> = {}) {
  return {
    cloudEntitlements: ["ponto", "whatsapp-bot", "sms"],
    cloudSyncedAt: new Date(),
    countryCode: "PT",
    pontoExitReminderTime: "18:00",
    pontoPauseReminderMinutes: 20,
    timezone: TZ,
    whatsappEnabled: true,
    ...over,
  };
}

function staffUser(over: Record<string, unknown> = {}) {
  return {
    externalWork: false,
    id: "user-1",
    name: "Rui Silva",
    phoneE164: "+351910000001",
    pontoSmsAllowed: false,
    username: "rui",
    ...over,
  };
}

function entry(over: Record<string, unknown>) {
  return {
    at: new Date("2026-01-10T08:00:00.000Z"),
    corrections: [],
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    proofs: {},
    status: "APROVADO",
    type: "ENTRADA",
    userId: "user-1",
    validations: [],
    ...over,
  };
}

/** dayRows = entries do staff (1.º findMany); saidaRows = SAIDA do dia
 *  (2.º findMany, where.type==="SAIDA"). */
function makePrisma(dayRows: unknown[], saidaRows: unknown[] = []) {
  mocks.timeEntryFindMany.mockImplementation(
    (args?: { where?: { type?: string } }) =>
      Promise.resolve(args?.where?.type === "SAIDA" ? saidaRows : dayRows)
  );
  return {
    timeEntry: { findMany: mocks.timeEntryFindMany },
    user: { findMany: mocks.userFindMany },
  } as unknown as DbClient;
}

const EVOLUTION_CHANNEL = {
  config: { apiUrl: "http://evo", instance: "oficinaos" },
  mode: "evolution" as const,
};
const OFFICIAL_CHANNEL = {
  config: { apiToken: "t", businessId: "b", phoneNumberId: "p" },
  mode: "local" as const,
};

beforeEach(() => {
  clearAllPendingPonto();
  clearPontoReminderState();
  vi.clearAllMocks();
  mocks.findShopSettingsUnique.mockResolvedValue(makeSettings());
  mocks.userFindMany.mockResolvedValue([staffUser()]);
  mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
  mocks.getSmsConfig.mockReturnValue(null);
});

describe("lembrete de saída (Esquecimentos)", () => {
  it("funcionário esquecido → SAIDA presumida MANUAL + lembrete + pending", async () => {
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    const input = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(input).toMatchObject({
      at: REMINDER_AT,
      proofs: { exitReminderPresumed: true },
      reason: "saída presumida — lembrete de saída",
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
      userId: "user-1",
    });
    // Evolution → texto livre com a hora do lembrete.
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    const text = mocks.sendWhatsAppText.mock.calls[0]?.[3] ?? "";
    expect(text).toContain("Saiu às 18:00");
    expect(text).toContain("Responda SIM");
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
    // Pending awaitingExit armado (~2 h) para a resposta SIM/hora —
    // a validade conta do `now` injetado do tick.
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).toMatchObject({
      presumedEntryId: "presumed-1",
    });
  });

  it("presumida já existente → não repete lembrete (dedupe por dia)", async () => {
    const presumed = entry({
      at: REMINDER_AT,
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma = makePrisma(
      [entry({ type: "ENTRADA" }), presumed],
      [presumed]
    );

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
  });

  it("SAIDA real no dia → funcionário já saiu, sem lembrete", async () => {
    const saida = entry({
      at: new Date("2026-01-10T17:00:00.000Z"),
      type: "SAIDA",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" }), saida], [saida]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("externalWork → NUNCA lembrete de saída", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser({ externalWork: true })]);
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
  });

  it("antes da hora configurada → nada acontece", async () => {
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(
      prisma,
      log,
      undefined,
      new Date("2026-01-10T17:59:00.000Z") // 17:59 Lisboa
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("módulo ponto inativo → tick sai sem queries", async () => {
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ cloudEntitlements: ["whatsapp-bot"] })
    );
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.timeEntryFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});

describe("roteamento do lembrete por canal", () => {
  it("pontoSmsAllowed → SMS via Cloud", async () => {
    mocks.userFindMany.mockResolvedValue([
      staffUser({ pontoSmsAllowed: true }),
    ]);
    mocks.getSmsConfig.mockReturnValue({
      cloud: { apiUrl: "https://cloud", token: "tok" },
      local: null,
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendSmsViaCloud).toHaveBeenCalledTimes(1);
    const input = mocks.sendSmsViaCloud.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(input.dedupeId).toBe("ponto-exit-presumed-1");
    expect(input.text).toContain("Saiu às 18:00");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
  });

  it("WhatsApp oficial (Meta) → template ponto_lembrete aprovado", async () => {
    mocks.resolveWhatsAppChannel.mockReturnValue(OFFICIAL_CHANNEL);
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendWhatsAppTemplateVia).toHaveBeenCalledTimes(1);
    const args = mocks.sendWhatsAppTemplateVia.mock.calls[0] ?? [];
    expect(args[3]).toBe("ponto_lembrete");
    expect(args[4]).toBe("pt_PT");
    expect(args[5]).toEqual(["18:00"]);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });
});

describe("alerta ao gestor (>60 min sem correção)", () => {
  it("presumida velha → notify ponto_saida_pendente uma vez", async () => {
    const presumed = entry({
      at: REMINDER_AT,
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma = makePrisma(
      [entry({ type: "ENTRADA" }), presumed],
      [presumed]
    );
    const late = new Date("2026-01-10T19:30:00.000Z"); // 90 min depois

    await processPontoReminders(prisma, log, undefined, late);
    await processPontoReminders(prisma, log, undefined, late);

    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const event = mocks.notify.mock.calls[0]?.[1] as {
      context: Record<string, unknown>;
      eventName: string;
      recipients: { userIds: string[] };
    };
    expect(event.eventName).toBe("ponto_saida_pendente");
    expect(event.recipients.userIds).toEqual(["mgr-1"]);
    expect(event.context).toMatchObject({ exitTime: "18:00" });
    // O broadcast websocket é responsabilidade do notify() real —
    // aqui basta verificar que o evento certo foi despachado.
  });

  it("presumida recente (<60 min) → ainda sem alerta", async () => {
    const presumed = entry({
      at: REMINDER_AT,
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma = makePrisma(
      [entry({ type: "ENTRADA" }), presumed],
      [presumed]
    );

    await processPontoReminders(prisma, log, undefined, NOW_AFTER); // 30 min

    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("presumida já corrigida → sem alerta", async () => {
    const presumed = entry({
      at: REMINDER_AT,
      corrections: [{ id: "corr-1" }],
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma = makePrisma(
      [entry({ type: "ENTRADA" }), presumed],
      [presumed]
    );

    await processPontoReminders(
      prisma,
      log,
      undefined,
      new Date("2026-01-10T20:00:00.000Z")
    );

    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe("lembrete de pausa (§2.2b)", () => {
  it("pausa >20 min → texto 'ainda em pausa' uma vez por pausa", async () => {
    // Sem lembrete de saída configurado — isola a perna da pausa.
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: null })
    );
    const pausa = entry({
      at: new Date("2026-01-10T17:55:00.000Z"), // 35 min às 18:30
      id: "pause-1",
      type: "PAUSA",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" }), pausa]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);
    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    const text = mocks.sendWhatsAppText.mock.calls[0]?.[3] ?? "";
    expect(text).toContain("ainda está em pausa");
  });

  it("pausa + saída por lembrar → recebe os dois lembretes", async () => {
    const pausa = entry({
      at: new Date("2026-01-10T17:55:00.000Z"),
      id: "pause-1",
      type: "PAUSA",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" }), pausa]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    // §6: quem está em pausa também é "a trabalhar" para o esquecimento
    // — presumida + pergunta de saída; §2.2b: + lembrete de pausa.
    const texts = mocks.sendWhatsAppText.mock.calls.map((c) => c[3]);
    expect(texts.some((t) => t.includes("Saiu às 18:00"))).toBe(true);
    expect(texts.some((t) => t.includes("ainda está em pausa"))).toBe(true);
  });

  it("pausa recente (<20 min) → sem lembrete", async () => {
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: null })
    );
    const pausa = entry({
      at: new Date("2026-01-10T18:20:00.000Z"), // 10 min
      type: "PAUSA",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" }), pausa]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });
});
