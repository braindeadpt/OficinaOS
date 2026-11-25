import { beforeEach, describe, expect, it, vi } from "vitest";

// Scheduler do livro de ponto (item 5 + §2.2b): tick de 15 min que
// cria a SAIDA presumida à pontoExitReminderTime, envia o lembrete
// pelo canal do ponto e alerta os gestores passado 60 min sem
// correção. Canais e envio são mocks — o estado (state.ts) corre a
// valer para verificar o pending awaitingExit.

const mocks = vi.hoisted(() => ({
  approvedTemplateBodyOf: vi.fn(() => null as string | null),
  findManyUsers: vi.fn(() => Promise.resolve([{ id: "mgr-1" }])),
  findShopSettingsUnique: vi.fn(),
  getSmsConfig: vi.fn(),
  notificationTemplateFindFirst: vi.fn(
    (): Promise<{ body: string; name: string } | null> =>
      Promise.resolve({
        body: "OficinaOS: ainda não tem saída registada. Saiu às {{exitTime}}? Responda SIM ou indique a hora.",
        name: "ponto_lembrete",
      })
  ),
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
      Promise.resolve({ messageId: "evo-msg-1", success: true })
  ),
  syncWhatsAppTemplates: vi.fn(() => Promise.resolve({})),
  templateStatusOf: vi.fn(
    (_settings: unknown, _name: string) => "APPROVED" as string | null
  ),
  timeEntryFindFirst: vi.fn(
    (): Promise<{ id: string } | null> => Promise.resolve(null)
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
  approvedTemplateBodyOf: mocks.approvedTemplateBodyOf,
  metaConditionalVars: vi.fn(() => ({})),
  // Versão mínima do real: vars {{x}} por ordem de aparecimento →
  // params na mesma ordem (sem blocos condicionais — o modelo do
  // lembrete não os tem).
  orderedTemplateParams: vi.fn((body: string, vars: Record<string, string>) => {
    const order: string[] = [];
    for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
      if (!order.includes(m[1])) {
        order.push(m[1]);
      }
    }
    return order.map((v) => vars[v] ?? "");
  }),
  syncWhatsAppTemplates: mocks.syncWhatsAppTemplates,
  TEMPLATE_LANG: "pt_PT",
  templateStatusOf: mocks.templateStatusOf,
}));
vi.mock("../entries.js", () => ({ recordPontoEntry: mocks.recordPontoEntry }));

import type { DbClient } from "../../../repositories/types.js";
import { clearPontoReminderState, processPontoReminders } from "../reminder.js";
import {
  clearAllPendingPonto,
  getPendingPontoExit,
  setPendingPontoExit,
} from "../state.js";

const TZ = "Europe/Lisbon";
// Sábado 10-01-2026: Lisboa = UTC+0. Lembrete às 18:00 → 18:00Z.
const NOW_AFTER = new Date("2026-01-10T18:30:00.000Z"); // 18:30 Lisboa
const REMINDER_AT = new Date("2026-01-10T18:00:00.000Z");

const warnSpy = vi.fn();
const log = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: warnSpy,
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
    createdAt: new Date("2026-01-10T08:00:00.000Z"),
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    proofs: {},
    status: "APROVADO",
    type: "ENTRADA",
    userId: "user-1",
    validations: [],
    ...over,
  };
}

/** dayRows = entries do staff (1.º findMany); saidaRows = SAIDA
 *  (2.º findMany, where.type==="SAIDA" — cobre hoje E ontem, para a
 *  retoma de envios adiados atravessar a meia-noite). Ambas respeitam
 *  o at.gte/lt do where. timeEntry.findFirst emula a re-leitura
 *  anti-duplicado: SAIDA do user, sem correções nem RECUSADO e
 *  POSTERIOR ao gt do turno em aberto quando presente. */
function makePrisma(dayRows: unknown[], saidaRows: unknown[] = []) {
  mocks.timeEntryFindMany.mockImplementation(
    (args?: { where?: { at?: { gte?: Date; lt?: Date }; type?: string } }) => {
      const w = args?.where;
      const rows = (w?.type === "SAIDA" ? saidaRows : dayRows) as Record<
        string,
        unknown
      >[];
      const gte = w?.at?.gte?.getTime();
      const lt = w?.at?.lt?.getTime();
      return Promise.resolve(
        rows.filter(
          (r) =>
            (gte === undefined || (r.at as Date).getTime() >= gte) &&
            (lt === undefined || (r.at as Date).getTime() < lt)
        )
      );
    }
  );
  mocks.timeEntryFindFirst.mockImplementation(
    (args?: {
      where?: {
        at?: { gt?: Date };
        type?: string;
        userId?: string;
      };
    }) => {
      const w = args?.where;
      const gt = w?.at?.gt?.getTime();
      const lt = (w?.at as { lt?: Date } | undefined)?.lt?.getTime();
      const hit = (
        [...dayRows, ...saidaRows] as Record<string, unknown>[]
      ).find(
        (r) =>
          r.type === "SAIDA" &&
          r.userId === w?.userId &&
          (r.corrections as unknown[]).length === 0 &&
          (r.validations as { decision: string }[])[0]?.decision !==
            "RECUSADO" &&
          (gt === undefined || (r.at as Date).getTime() > gt) &&
          (lt === undefined || (r.at as Date).getTime() < lt)
      );
      return Promise.resolve(hit ? { id: hit.id as string } : null);
    }
  );
  return {
    notificationTemplate: {
      findFirst: mocks.notificationTemplateFindFirst,
    },
    timeEntry: {
      findFirst: mocks.timeEntryFindFirst,
      findMany: mocks.timeEntryFindMany,
    },
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
const CLOUD_CHANNEL = {
  apiUrl: "https://cloud.test",
  mode: "cloud" as const,
  shopToken: "tok",
};

beforeEach(() => {
  clearAllPendingPonto();
  clearPontoReminderState();
  vi.clearAllMocks();
  mocks.findShopSettingsUnique.mockResolvedValue(makeSettings());
  mocks.userFindMany.mockResolvedValue([staffUser()]);
  mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
  mocks.getSmsConfig.mockReturnValue(null);
  // Re-pondo valores mutados por casos anteriores (mockClear não
  // remove implementações).
  mocks.timeEntryFindFirst.mockResolvedValue(null);
  mocks.notificationTemplateFindFirst.mockResolvedValue({
    body: "OficinaOS: ainda não tem saída registada. Saiu às {{exitTime}}? Responda SIM ou indique a hora.",
    name: "ponto_lembrete",
  });
  mocks.approvedTemplateBodyOf.mockReturnValue(null);
  mocks.templateStatusOf.mockReturnValue("APPROVED");
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
    // a validade conta do `now` injetado do tick. O id da mensagem
    // enviada vai junto: uma resposta citada (reply-quote) só confirma
    // se apontar para esta pergunta.
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).toMatchObject({
      presumedEntryId: "presumed-1",
      sentMessageIds: ["evo-msg-1"],
    });
  });

  it("lembrete entre o último ciclo do dia e a meia-noite é recuperado no ciclo seguinte", async () => {
    // Ciclos a cada 15 min: 23:46 → 00:01. Com lembrete às 23:55,
    // nenhum ciclo de 10/01 acontece depois da hora — sem recuperação,
    // o turno de ontem ficava sem presumida nem pergunta.
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: "23:55" })
    );
    const entrada = entry({
      at: new Date("2026-01-10T09:00:00.000Z"),
      type: "ENTRADA",
    });
    const prisma = makePrisma([entrada], []);

    // 00:05 Lisboa de 11/01 — o ciclo já é do dia seguinte.
    const now = new Date("2026-01-11T00:05:00.000Z");
    await processPontoReminders(prisma, log, undefined, now);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    const input = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    // A presumida fica no dia civil do turno (10/01 às 23:55) — o
    // apuramento de ontem fecha e hoje arranca limpo.
    expect(input).toMatchObject({
      at: new Date("2026-01-10T23:55:00.000Z"),
      type: "SAIDA",
      userId: "user-1",
    });
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsAppText.mock.calls[0]?.[3] ?? "").toContain(
      "Saiu às 23:55"
    );
  });

  it("recuperação da véspera não repete quando já há SAIDA no dia civil dela", async () => {
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: "23:55" })
    );
    const entrada = entry({
      at: new Date("2026-01-10T09:00:00.000Z"),
      type: "ENTRADA",
    });
    // O trabalhador picou a saída na véspera — a recuperação não pode
    // criar uma segunda saída sobre o turno fechado.
    const saida = entry({
      at: new Date("2026-01-10T23:50:00.000Z"),
      type: "SAIDA",
    });
    const prisma = makePrisma([entrada, saida], [saida]);

    await processPontoReminders(
      prisma,
      log,
      undefined,
      new Date("2026-01-11T00:05:00.000Z")
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });

  it("correção depois da meia-noite fecha o turno — recuperação não duplica a presumida", async () => {
    // A resposta à presumida das 23:55 declarou 00:30 — a correção
    // ficou no dia civil seguinte. Sem o teto no instante do tick,
    // a recuperação relia só a véspera e gravava outra presumida.
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: "23:55" })
    );
    const entrada = entry({
      at: new Date("2026-01-10T09:00:00.000Z"),
      type: "ENTRADA",
    });
    const correcao = entry({
      at: new Date("2026-01-11T00:30:00.000Z"),
      type: "SAIDA",
    });
    const prisma = makePrisma([entrada, correcao], [correcao]);

    await processPontoReminders(
      prisma,
      log,
      undefined,
      new Date("2026-01-11T00:35:00.000Z")
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });

  it("lembrete ativado de manhã não preenche retroatamente a véspera", async () => {
    // A recuperação existe para a janela minúscula entre o último
    // ciclo do dia e a meia-noite — passado o TTL da resposta (~2 h)
    // não faz sentido perguntar, e uma configuração ligada agora não
    // pode ter efeito retroativo sobre ontem.
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: "23:55" })
    );
    const entrada = entry({
      at: new Date("2026-01-10T09:00:00.000Z"),
      type: "ENTRADA",
    });
    const prisma = makePrisma([entrada], []);

    // 09:00 do dia seguinte — 9 h depois da hora perdida.
    await processPontoReminders(
      prisma,
      log,
      undefined,
      new Date("2026-01-11T09:00:00.000Z")
    );

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("SAIDA picada a meio do ciclo (depois do instante injetado) → sem presumida duplicada", async () => {
    // O trabalhador picou SAIDA às 18:31 — um minuto DEPOIS do
    // instante do tick (18:30) mas antes da re-leitura anti-duplicado.
    // O teto da procura é o instante da consulta, não o do ciclo —
    // senão o livro ficava também com uma saída presumida.
    const entrada = entry({
      at: new Date("2026-01-10T08:00:00.000Z"),
      type: "ENTRADA",
    });
    const prisma = makePrisma([entrada], []);
    // A saída não está na leitura em lote (foi picada depois dela) —
    // só existe na base de dados que a re-leitura consulta. O mock
    // respeita o teto `lt` da query: com o instante injetado do ciclo
    // (18:30) a saída das 18:31 ficava de fora e gravava-se a
    // presumida em cima; com o instante da consulta entra.
    const saidaAt = new Date("2026-01-10T18:31:00.000Z").getTime();
    mocks.timeEntryFindFirst.mockImplementation((args?: unknown) => {
      const lt = (
        args as { where?: { at?: { lt?: Date } } } | undefined
      )?.where?.at?.lt?.getTime();
      return Promise.resolve(
        lt !== undefined && saidaAt < lt ? { id: "saida-1" } : null
      );
    });

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
  });

  it("presumida já perguntada (pending vivo) → não repete lembrete", async () => {
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
    // A pergunta já foi entregue — o pending de resposta está aberto.
    setPendingPontoExit("user-1", {
      expiresAt: NOW_AFTER.getTime() + 3_600_000,
      presumedAt: REMINDER_AT.toISOString(),
      presumedEntryId: presumed.id as string,
      userId: "user-1",
    });

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
  });

  it("presumida com envio adiado → tick seguinte entrega com a MESMA saída", async () => {
    // 1.º tick: modelo Meta em revisão — a presumida fecha o turno mas
    // a pergunta não sai e a janela de resposta NÃO abre.
    mocks.resolveWhatsAppChannel.mockReturnValue(CLOUD_CHANNEL);
    mocks.templateStatusOf.mockReturnValue(null);
    const entrada = entry({ type: "ENTRADA" });
    const prisma1 = makePrisma([entrada]);

    await processPontoReminders(prisma1, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).toBeNull();

    // 2.º tick: modelo aprovado — re-tenta com a presumida gravada no
    // 1.º (uma só saída, um só envio) e abre a janela agora.
    mocks.templateStatusOf.mockReturnValue("APPROVED");
    const presumed = entry({
      at: REMINDER_AT,
      id: "presumed-1",
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma2 = makePrisma([entrada, presumed], [presumed]);
    const later = new Date("2026-01-10T18:15:00.000Z");

    await processPontoReminders(prisma2, log, undefined, later);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsAppTemplateVia).toHaveBeenCalledTimes(1);
    expect(getPendingPontoExit("user-1", later.getTime())).toMatchObject({
      presumedEntryId: "presumed-1",
    });
  });

  it("lembrete desligado entre ciclos → retoma não entrega a pergunta adiada", async () => {
    // 1.º tick: modelo Meta em revisão — a presumida grava-se e o
    // envio fica adiado.
    mocks.resolveWhatsAppChannel.mockReturnValue(CLOUD_CHANNEL);
    mocks.templateStatusOf.mockReturnValue(null);
    const entrada = entry({ type: "ENTRADA" });
    const prisma1 = makePrisma([entrada]);

    await processPontoReminders(prisma1, log, undefined, NOW_AFTER);

    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();

    // O gestor apaga a hora nas definições (null = lembrete
    // desligado) e a Meta aprova o modelo entretanto — a retoma não
    // pode entregar a pergunta a um lembrete desativado.
    mocks.templateStatusOf.mockReturnValue("APPROVED");
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: null })
    );
    const presumed = entry({
      at: REMINDER_AT,
      id: "presumed-1",
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma2 = makePrisma([entrada, presumed], [presumed]);
    const later = new Date("2026-01-10T18:15:00.000Z");

    await processPontoReminders(prisma2, log, undefined, later);

    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1", later.getTime())).toBeNull();
  });

  it("envio adiado às 23:50 → retoma no tick depois da meia-noite", async () => {
    // Lembrete tardio: a presumida das 23:30 fica adiada com o modelo
    // em revisão e a aprovação chega já no dia civil seguinte.
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ pontoExitReminderTime: "23:30" })
    );
    mocks.resolveWhatsAppChannel.mockReturnValue(CLOUD_CHANNEL);
    mocks.templateStatusOf.mockReturnValue(null);
    const entrada = entry({ type: "ENTRADA" });
    const late = new Date("2026-01-10T23:50:00.000Z"); // 23:50 Lisboa

    await processPontoReminders(makePrisma([entrada]), log, undefined, late);

    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();

    // Aprovado às 00:10 — a varredura das SAIDA inclui o dia anterior,
    // por isso a retoma encontra a presumida aberta e entrega-a.
    mocks.templateStatusOf.mockReturnValue("APPROVED");
    const presumed = entry({
      at: new Date("2026-01-10T23:30:00.000Z"),
      id: "presumed-1",
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    const prisma2 = makePrisma([entrada, presumed], [presumed]);
    const afterMidnight = new Date("2026-01-11T00:10:00.000Z");

    await processPontoReminders(prisma2, log, undefined, afterMidnight);

    expect(mocks.sendWhatsAppTemplateVia).toHaveBeenCalledTimes(1);
    // Uma só presumida — a retoma reutiliza a gravada no 1.º tick.
    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    expect(
      getPendingPontoExit("user-1", afterMidnight.getTime())
    ).toMatchObject({
      presumedAt: "2026-01-10T23:30:00.000Z",
      presumedEntryId: "presumed-1",
    });
  });

  it("retoma depois da meia-noite → abertura gravada na presumida veda saídas antes da entrada", async () => {
    // O turno abriu às 16:00 de ontem e o lembrete das 23:30 ficou
    // adiado: na retoma de hoje (00:10) a ENTRADA já não está nas
    // marcações do dia — a abertura gravada nos proofs da presumida
    // é que vai no pending, senão uma resposta «1:15» era lida como
    // 13:15 de ontem e gravada ANTES da própria entrada.
    mocks.resolveWhatsAppChannel.mockReturnValue(EVOLUTION_CHANNEL);
    const presumed = entry({
      at: new Date("2026-01-10T23:30:00.000Z"),
      id: "presumed-1",
      proofs: {
        exitReminderPresumed: true,
        exitReminderShiftOpenAt: "2026-01-10T16:00:00.000Z",
      },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
    });
    // Sem marcações hoje: a lista de SAIDA (ontem+hoje) traz a
    // presumida aberta; a de entries do dia está vazia.
    const prisma = makePrisma([], [presumed]);
    const afterMidnight = new Date("2026-01-11T00:10:00.000Z");

    await processPontoReminders(prisma, log, undefined, afterMidnight);

    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(
      getPendingPontoExit("user-1", afterMidnight.getTime())
    ).toMatchObject({
      presumedEntryId: "presumed-1",
      sentMessageIds: ["evo-msg-1"],
      shiftOpenAt: "2026-01-10T16:00:00.000Z",
    });
  });

  it("presumida grava a abertura do turno nos proofs", async () => {
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    const input = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(input.proofs).toMatchObject({
      exitReminderPresumed: true,
      exitReminderShiftOpenAt: "2026-01-10T08:00:00.000Z",
    });
  });

  it("varrimento de ontem respeita o dia civil em mudança de hora (23 h e 25 h)", async () => {
    // A varredura de SAIDA cobre o dia anterior — o limite é o INÍCIO
    // do dia civil anterior, não `start − 24 h` (que erra nos dias de
    // 23/25 h da mudança de hora).
    const saidaGte = () => {
      const call = mocks.timeEntryFindMany.mock.calls
        .map((c) => c[0] as { where?: { type?: string; at?: { gte?: Date } } })
        .find((a) => a.where?.type === "SAIDA");
      return call?.where?.at?.gte?.toISOString();
    };

    // Segunda 30-03-2026 00:15 Lisboa: ontem (domingo) teve 23 h — o
    // relógio saltou 01:00→02:00. O limite correto é a meia-noite de
    // domingo (2026-03-29T00:00Z); com −24 h seria sábado 23:00.
    await processPontoReminders(
      makePrisma([], []),
      log,
      undefined,
      new Date("2026-03-30T00:15:00.000Z")
    );
    expect(saidaGte()).toBe("2026-03-29T00:00:00.000Z");

    mocks.timeEntryFindMany.mockClear();

    // Segunda 26-10-2026 00:15 Lisboa: ontem teve 25 h (02:00→01:00).
    // O limite correto é a meia-noite de domingo (2026-10-24T23:00Z);
    // com −24 h seria domingo 00:00Z — a primeira hora ficava de fora.
    await processPontoReminders(
      makePrisma([], []),
      log,
      undefined,
      new Date("2026-10-26T00:15:00.000Z")
    );
    expect(saidaGte()).toBe("2026-10-24T23:00:00.000Z");

    // Atlantic/Azores, domingo 25-10-2026 00:30 local na 2.ª passagem
    // (01:30Z): a meia-noite local ocorre duas vezes (00:00Z e 01:00Z —
    // no recuo o relógio salta 01:00→00:00, verão = UTC+0, inverno =
    // UTC−1) e a conversão do início do dia escolhe a segunda — recuar
    // um instante antes do start continua em 25/10 e esqueceria
    // sábado. O limite certo é a meia-noite local de sábado 24/10 —
    // 00:00Z, offset de verão — que só sai da DATA civil menos um dia.
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ timezone: "Atlantic/Azores" })
    );
    mocks.timeEntryFindMany.mockClear();
    await processPontoReminders(
      makePrisma([], []),
      log,
      undefined,
      new Date("2026-10-25T01:30:00.000Z")
    );
    expect(saidaGte()).toBe("2026-10-24T00:00:00.000Z");
  });

  it("saída de um turno anterior não bloqueia o lembrete do turno aberto", async () => {
    // 08:00 entra · 12:00 sai · 14:00 entra de novo — a re-leitura só
    // conta saídas POSTERIORES à abertura do turno em curso.
    const saida12 = entry({
      at: new Date("2026-01-10T12:00:00.000Z"),
      type: "SAIDA",
    });
    const prisma = makePrisma(
      [
        entry({ type: "ENTRADA" }),
        saida12,
        entry({ at: new Date("2026-01-10T14:00:00.000Z"), type: "ENTRADA" }),
      ],
      [saida12]
    );

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).toHaveBeenCalledTimes(1);
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
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

  it("entrada depois da hora configurada → presumida não fica antes da entrada", async () => {
    // Turno tardio: primeira ENTRADA às 18:10 com lembrete às 18:00 —
    // a presumida ancora na marcação efetiva, nunca a precede.
    const entrada = entry({
      at: new Date("2026-01-10T18:10:00.000Z"),
      type: "ENTRADA",
    });
    const prisma = makePrisma([entrada]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    const input = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((input.at as Date).toISOString()).toBe("2026-01-10T18:10:00.000Z");
    // A pergunta pergunta a hora presumida real — o SIM confirma
    // exatamente o instante gravado.
    const text = mocks.sendWhatsAppText.mock.calls[0]?.[3] ?? "";
    expect(text).toContain("Saiu às 18:10");
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).toMatchObject({
      presumedAt: "2026-01-10T18:10:00.000Z",
      shiftOpenAt: "2026-01-10T18:10:00.000Z",
    });
  });

  it("regresso de pausa depois da hora configurada → presumida na hora do regresso", async () => {
    const prisma = makePrisma([
      entry({
        at: new Date("2026-01-10T09:00:00.000Z"),
        type: "ENTRADA",
      }),
      entry({ at: new Date("2026-01-10T13:00:00.000Z"), type: "PAUSA" }),
      entry({
        at: new Date("2026-01-10T18:20:00.000Z"),
        type: "VOLTEI",
      }),
    ]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    const input = mocks.recordPontoEntry.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect((input.at as Date).toISOString()).toBe("2026-01-10T18:20:00.000Z");
    // A abertura do turno é o VOLTEI — não a PAUSA.
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).toMatchObject({
      shiftOpenAt: "2026-01-10T18:20:00.000Z",
    });
  });

  it("SAIDA real registada durante o envio → não grava presumida em duplicado", async () => {
    // A leitura em lote é anterior ao envio; a re-leitura por
    // trabalhador apanha a saída real entretanto registada (a linha
    // só existe na consulta findFirst, não no lote).
    const saidaTardia = entry({
      at: new Date("2026-01-10T17:50:00.000Z"),
      type: "SAIDA",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" })], [saidaTardia]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.recordPontoEntry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(getPendingPontoExit("user-1")).toBeNull();
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

  it("pontoSmsAllowed sem canal SMS na loja → cai no WhatsApp", async () => {
    // Loja só com Evolution ativa: «Permitir SMS» ligado no
    // trabalhador não pode impedir o lembrete — a pergunta sai por
    // WhatsApp e o pending de resposta abre (envio real).
    mocks.userFindMany.mockResolvedValue([
      staffUser({ pontoSmsAllowed: true }),
    ]);
    mocks.getSmsConfig.mockReturnValue(null);
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendSmsViaCloud).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    const text = mocks.sendWhatsAppText.mock.calls[0]?.[3] ?? "";
    expect(text).toContain("Saiu às 18:00");
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).not.toBeNull();
  });

  it("pontoSmsAllowed sem canal SMS no oficial Meta → template, nunca texto livre", async () => {
    // Fora da janela de 24 h a Meta rejeita texto livre — o lembrete
    // business-initiated tem de ir pelo template aprovado mesmo
    // quando o trabalhador tem «Permitir SMS» e a loja não tem canal
    // SMS configurado.
    mocks.userFindMany.mockResolvedValue([
      staffUser({ pontoSmsAllowed: true }),
    ]);
    mocks.getSmsConfig.mockReturnValue(null);
    mocks.resolveWhatsAppChannel.mockReturnValue(OFFICIAL_CHANNEL);
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplateVia).toHaveBeenCalledTimes(1);
    const params = mocks.sendWhatsAppTemplateVia.mock.calls[0]?.[5] ?? [];
    expect(params).toContain("18:00");
    expect(getPendingPontoExit("user-1", NOW_AFTER.getTime())).not.toBeNull();
  });

  it("modelo renomeado nas definições → envio usa o nome atual", async () => {
    mocks.resolveWhatsAppChannel.mockReturnValue(OFFICIAL_CHANNEL);
    mocks.notificationTemplateFindFirst.mockResolvedValue({
      body: "OficinaOS: ainda não tem saída registada. Saiu às {{exitTime}}? Responda SIM ou indique a hora.",
      name: "lembrete_saida_v2",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    const args = mocks.sendWhatsAppTemplateVia.mock.calls[0] ?? [];
    expect(args[3]).toBe("lembrete_saida_v2");
    expect(args[5]).toEqual(["18:00"]);
  });

  it("cloud + template APPROVED → envio normal", async () => {
    mocks.resolveWhatsAppChannel.mockReturnValue(CLOUD_CHANNEL);
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    expect(mocks.sendWhatsAppTemplateVia).toHaveBeenCalledTimes(1);
    expect(mocks.syncWhatsAppTemplates).not.toHaveBeenCalled();
  });

  it("cloud + corpo aprovado noutra ordem → params seguem a ordem da Meta", async () => {
    // A versão APROVADA na Meta tem {{shopName}} antes de {{exitTime}};
    // o corpo local editado tem a ordem trocada — o envio tem de usar
    // a ordem que a aprovação cobre, não a da edição.
    mocks.resolveWhatsAppChannel.mockReturnValue(CLOUD_CHANNEL);
    mocks.findShopSettingsUnique.mockResolvedValue(
      makeSettings({ shopName: "Oficina X" })
    );
    mocks.approvedTemplateBodyOf.mockReturnValue(
      "Aviso {{shopName}}: saiu às {{exitTime}}?"
    );
    mocks.notificationTemplateFindFirst.mockResolvedValue({
      body: "Saiu às {{exitTime}}? ({{shopName}})",
      name: "ponto_lembrete",
    });
    const prisma = makePrisma([entry({ type: "ENTRADA" })]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    const args = mocks.sendWhatsAppTemplateVia.mock.calls[0] ?? [];
    expect(args[5]).toEqual(["Oficina X", "18:00"]);
  });

  it("cloud + template por aprovar → adia o envio e dispara re-sync uma vez", async () => {
    mocks.resolveWhatsAppChannel.mockReturnValue(CLOUD_CHANNEL);
    mocks.templateStatusOf.mockReturnValue(null);
    mocks.userFindMany.mockResolvedValue([
      staffUser({ id: "user-1", username: "rui" }),
      staffUser({ id: "user-2", phoneE164: "+351910000002", username: "ana" }),
    ]);
    const prisma = makePrisma([
      entry({ type: "ENTRADA", userId: "user-1" }),
      entry({ type: "ENTRADA", userId: "user-2" }),
    ]);

    await processPontoReminders(prisma, log, undefined, NOW_AFTER);

    // Dois trabalhadores, um só re-sync (throttle) e nenhum envio.
    expect(mocks.sendWhatsAppTemplateVia).not.toHaveBeenCalled();
    expect(mocks.syncWhatsAppTemplates).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
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

  it("presumida já validada pelo gestor → sem alerta", async () => {
    // A aprovação no painel é uma validação — não cria correção. Sem
    // este filtro o agendador continuava a pedir atenção do gestor
    // para uma linha que ele próprio já tinha decidido.
    const presumed = entry({
      at: REMINDER_AT,
      proofs: { exitReminderPresumed: true },
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
      validations: [{ decision: "APROVADO" }],
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
