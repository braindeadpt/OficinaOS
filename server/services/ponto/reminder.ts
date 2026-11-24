// Livro de ponto — item 5 (Esquecimentos) + §2.2b (lembrete de pausa).
//
// Tick periódico (scheduler em server/jobs/ponto-reminder-scheduler.ts,
// 15 min) que, para cada utilizador com pontoEnabled:
//
// 1. Computa o estado do dia a partir das entries EFETIVAS (sem
//    correções pendentes, sem RECUSADO por validação) — último evento
//    decide: SAIDA → já saiu; PAUSA → em pausa; ENTRADA/VOLTEI → a
//    trabalhar; nada → sem registo.
// 2. À pontoExitReminderTime (hh:mm da loja): quem ficou a trabalhar/
//    em pausa recebe uma SAIDA presumida (transport MANUAL,
//    proofs.exitReminderPresumed, POR_VALIDAR) + a pergunta
//    "Saiu às HH:MM? Responda SIM ou indique a hora." pelo canal do
//    ponto (SMS se pontoSmsAllowed; senão WhatsApp — Evolution texto
//    livre, oficial Meta template `ponto_lembrete`). A resposta cria o
//    pending awaitingExit no state.ts (~2 h) — ver handler.ts.
// 3. Quem está em pausa há mais de pontoPauseReminderMinutes recebe
//    "Ainda está em pausa?" UMA vez por pausa (dedupe em memória por
//    entry — documentado abaixo).
// 4. Presumida sem correção há >60 min → notify() aos OWNER+FRONT_DESK
//    (template IN_APP ponto_saida_pendente → central + websocket).
//    Dedupe em memória por entryId — reinício do processo pode repetir
//    UM alerta por presumida ainda aberta (escolha aceite: a alternativa
//    — consultar notificações por texto — era frágil com homónimos).
//
// Custo: 3 queries por tick (settings + utilizadores + entries do dia)
// e só quando o módulo "ponto" está ativo com cache de entitlements
// fresco. Idempotente: a presumida existente É a marca de "já
// perguntámos" — ticks seguintes não repetem.

import { Role } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { findManyUsers } from "../../repositories/notification.repository.js";
import { findShopSettingsUnique } from "../../repositories/settings.repository.js";
import type { DbClient } from "../../repositories/types.js";
import { isModuleEnabled } from "../../utils/modules.js";
import { dayRange, zonedDateTimeToUtc } from "../../utils/time-range.js";
import { notify } from "../notification-dispatch.js";
import { getSmsConfig } from "../notification-outbox.service.js";
import { formatPhone } from "../notification-sender.js";
import { sendSms } from "../sms.service.js";
import {
  isDefinitiveCloudError,
  sendSmsViaCloud,
} from "../sms-cloud.service.js";
import {
  resolveWhatsAppChannel,
  sendWhatsAppTemplateVia,
  sendWhatsAppText,
} from "../whatsapp-channel.js";
import { TEMPLATE_LANG } from "../whatsapp-templates.service.js";
import { recordPontoEntry } from "./entries.js";
import { PONTO_EXIT_PENDING_TTL_MS, setPendingPontoExit } from "./state.js";
import {
  PONTO_LEMBRETE_TEMPLATE,
  PONTO_TEXT,
  pontoExitReminderText,
} from "./transport.js";

/** >60 min sem correção → alerta aos gestores (spec item 5). */
const EXIT_ALERT_AFTER_MS = 60 * 60 * 1000;
const EXIT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Dedupes em memória — o processo é único (docker compose); o custo de
// um restart é repetir no máximo um alerta/lembrete por entry aberta.
const pauseReminded = new Set<string>(); // `${userId}:${entryId}`
const exitAlerted = new Set<string>(); // presumedEntryId

/** Apenas para testes — esvazia os dedupes entre casos. */
export function clearPontoReminderState(): void {
  pauseReminded.clear();
  exitAlerted.clear();
}

type ShopSettings = NonNullable<
  Awaited<ReturnType<typeof findShopSettingsUnique>>
>;
interface StaffUser {
  externalWork: boolean;
  id: string;
  name: string | null;
  phoneE164: string | null;
  pontoSmsAllowed: boolean;
  username: string;
}
interface DayEntry {
  at: Date;
  corrections: { id: string }[];
  id: string;
  proofs: unknown;
  status: string;
  type: string;
  userId: string;
  validations: { decision: string }[];
}

/** Estado efetivo do dia: última entry utilizável (não superseded,
 *  não RECUSADO por validação) decide — espelha a semântica do painel. */
function effectiveEntries(entries: DayEntry[]): DayEntry[] {
  return entries
    .filter(
      (e) =>
        e.corrections.length === 0 && e.validations[0]?.decision !== "RECUSADO"
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function isPresumed(e: DayEntry): boolean {
  const p = e.proofs;
  return (
    typeof p === "object" &&
    p !== null &&
    (p as Record<string, unknown>).exitReminderPresumed === true
  );
}

function hhmmAt(tz: string, at: Date): string {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: tz,
  }).format(at);
}

/** Envia texto livre pelo canal do ponto: SMS se permitido, senão
 *  WhatsApp (Evolution texto; Meta oficial também aceita freeform
 *  dentro da janela de 24 h — a pausa implica mensagem recente). */
async function sendPontoText(
  prisma: DbClient,
  settings: ShopSettings,
  waChannel: ReturnType<typeof resolveWhatsAppChannel>,
  smsChannels: ReturnType<typeof getSmsConfig>,
  user: StaffUser,
  text: string,
  dedupeId: string
): Promise<void> {
  const phone = user.phoneE164;
  if (!phone) {
    return;
  }
  const countryCode = settings.countryCode;
  if (user.pontoSmsAllowed) {
    if (!smsChannels) {
      return;
    }
    const to = formatPhone(phone, countryCode);
    let result = smsChannels.cloud
      ? await sendSmsViaCloud(smsChannels.cloud, {
          dedupeId,
          text,
          to,
        }).catch(() => ({ error: "NETWORK", success: false }))
      : null;
    if (
      !result?.success &&
      smsChannels.local &&
      (result === null || isDefinitiveCloudError(result.error))
    ) {
      result = await sendSms(smsChannels.local, phone, text, countryCode);
    }
    if (!result?.success) {
      throw new Error(result?.error ?? "SMS falhou");
    }
    return;
  }
  if (!waChannel) {
    return;
  }
  const result = await sendWhatsAppText(
    prisma,
    waChannel,
    phone,
    text,
    countryCode,
    settings
  );
  if (!result.success) {
    throw new Error(result.error ?? "WhatsApp falhou");
  }
}

/** Lembrete de saída: business-initiated — Evolution recebe texto
 *  livre; o oficial Meta exige o template aprovado `ponto_lembrete`
 *  (única via fora da janela de 24 h). SMS quando pontoSmsAllowed. */
async function sendExitReminder(
  prisma: DbClient,
  settings: ShopSettings,
  waChannel: ReturnType<typeof resolveWhatsAppChannel>,
  smsChannels: ReturnType<typeof getSmsConfig>,
  user: StaffUser,
  exitTime: string,
  dedupeId: string
): Promise<void> {
  const phone = user.phoneE164;
  if (!phone) {
    return;
  }
  const countryCode = settings.countryCode;
  if (user.pontoSmsAllowed) {
    await sendPontoText(
      prisma,
      settings,
      waChannel,
      smsChannels,
      user,
      pontoExitReminderText(exitTime),
      dedupeId
    );
    return;
  }
  if (!waChannel) {
    return;
  }
  if (waChannel.mode === "evolution") {
    const result = await sendWhatsAppText(
      prisma,
      waChannel,
      phone,
      pontoExitReminderText(exitTime),
      countryCode,
      settings
    );
    if (!result.success) {
      throw new Error(result.error ?? "WhatsApp falhou");
    }
    return;
  }
  const result = await sendWhatsAppTemplateVia(
    prisma,
    waChannel,
    phone,
    PONTO_LEMBRETE_TEMPLATE,
    TEMPLATE_LANG,
    [exitTime],
    countryCode,
    settings
  );
  if (!result.success) {
    throw new Error(result.error ?? "template WhatsApp falhou");
  }
}

/** Alerta aos gestores: notify() IN_APP (ponto_saida_pendente) —
 *  central de notificações + websocket, sem canais externos. */
async function alertManagers(
  prisma: DbClient,
  wsBroadcast: Parameters<typeof notify>[0]["wsBroadcast"],
  presumed: DayEntry,
  workerName: string,
  exitTime: string,
  log: FastifyBaseLogger
): Promise<void> {
  const managers = await findManyUsers(
    prisma,
    { isActive: true, role: { in: [Role.OWNER, Role.FRONT_DESK] } },
    { id: true }
  );
  const userIds = managers.map((m) => m.id);
  if (userIds.length === 0) {
    return;
  }
  await notify(
    { prisma, wsBroadcast },
    {
      context: { exitTime, workerName },
      eventName: "ponto_saida_pendente",
      recipients: { userIds },
    }
  ).catch((err) =>
    log.warn(
      { err, presumedId: presumed.id },
      "ponto: alerta a gestores falhou"
    )
  );
}

interface UserTickArgs {
  exitTime: string | null;
  last: DayEntry | undefined;
  log: FastifyBaseLogger;
  now: Date;
  pauseReminderMs: number;
  presumedUserIds: Set<string>;
  prisma: DbClient;
  reminderInstant: Date | null;
  settings: ShopSettings;
  shouldAskExit: boolean;
  smsChannels: ReturnType<typeof getSmsConfig>;
  user: StaffUser;
  waChannel: ReturnType<typeof resolveWhatsAppChannel>;
}

/** Um utilizador num tick: lembrete de saída (Esquecimentos) e/ou de
 *  pausa (§2.2b). Erros sobem para o try/catch do chamador. */
async function processUserTick(a: UserTickArgs): Promise<void> {
  const {
    exitTime,
    last,
    log,
    now,
    pauseReminderMs,
    presumedUserIds,
    prisma,
    reminderInstant,
    settings,
    shouldAskExit,
    smsChannels,
    user,
    waChannel,
  } = a;

  // — Lembrete de saída (Esquecimentos) —
  if (
    shouldAskExit &&
    exitTime &&
    reminderInstant &&
    !user.externalWork &&
    !presumedUserIds.has(user.id) &&
    last &&
    last.type !== "SAIDA"
  ) {
    const presumed = await recordPontoEntry(prisma, {
      at: reminderInstant,
      proofs: { exitReminderPresumed: true },
      reason: "saída presumida — lembrete de saída",
      status: "POR_VALIDAR",
      transport: "MANUAL",
      type: "SAIDA",
      userId: user.id,
    });
    setPendingPontoExit(user.id, {
      expiresAt: now.getTime() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: reminderInstant.toISOString(),
      presumedEntryId: presumed.id,
      userId: user.id,
    });
    if (waChannel || (user.pontoSmsAllowed && smsChannels)) {
      await sendExitReminder(
        prisma,
        settings,
        waChannel,
        smsChannels,
        user,
        exitTime,
        `ponto-exit-${presumed.id}`
      );
    } else {
      log.warn(
        { userId: user.id },
        "ponto: sem canal para lembrete de saída — presumida fica POR_VALIDAR"
      );
    }
  }

  // — Lembrete de pausa (§2.2b) — uma vez por PAUSA, nunca fecha.
  if (
    last?.type === "PAUSA" &&
    pauseReminderMs > 0 &&
    now.getTime() - last.at.getTime() >= pauseReminderMs &&
    !pauseReminded.has(`${user.id}:${last.id}`)
  ) {
    pauseReminded.add(`${user.id}:${last.id}`);
    if (
      user.phoneE164 &&
      (waChannel || (user.pontoSmsAllowed && smsChannels))
    ) {
      await sendPontoText(
        prisma,
        settings,
        waChannel,
        smsChannels,
        user,
        PONTO_TEXT.pauseReminder,
        `ponto-pause-${user.id}-${last.id}`
      );
    }
  }
}

/**
 * Um tick do scheduler. `now` injetável para testes.
 */
export async function processPontoReminders(
  prisma: DbClient,
  log: FastifyBaseLogger,
  wsBroadcast?: Parameters<typeof notify>[0]["wsBroadcast"],
  now: Date = new Date()
): Promise<void> {
  const settings = await findShopSettingsUnique(prisma);
  if (!(settings && isModuleEnabled(settings, "ponto"))) {
    return;
  }
  const tz = settings.timezone ?? process.env.TZ ?? "UTC";
  const range = dayRange(tz, now);
  const { start, end } = range;

  const staff = await prisma.user.findMany({
    select: {
      externalWork: true,
      id: true,
      name: true,
      phoneE164: true,
      pontoSmsAllowed: true,
      username: true,
    },
    where: { isActive: true, pontoEnabled: true },
  });
  const staffIds = staff.map((u) => u.id);

  // Entries do dia para TODO o staff de uma vez + varrimento das
  // presumidas (inclui quem tenha pontoEnabled desligado entretanto —
  // o alerta ao gestor não pode depender da flag atual).
  const [dayEntries, saidaEntries] = await Promise.all([
    staffIds.length
      ? prisma.timeEntry.findMany({
          orderBy: { at: "asc" },
          select: {
            at: true,
            corrections: { select: { id: true }, take: 1 },
            id: true,
            proofs: true,
            status: true,
            type: true,
            userId: true,
            validations: {
              orderBy: { at: "desc" },
              select: { decision: true },
              take: 1,
            },
          },
          where: { at: { gte: start, lt: end }, userId: { in: staffIds } },
        })
      : Promise.resolve([]),
    prisma.timeEntry.findMany({
      orderBy: { at: "asc" },
      select: {
        at: true,
        corrections: { select: { id: true }, take: 1 },
        id: true,
        proofs: true,
        status: true,
        type: true,
        userId: true,
        validations: {
          orderBy: { at: "desc" },
          select: { decision: true },
          take: 1,
        },
      },
      where: { at: { gte: start, lt: end }, type: "SAIDA" },
    }),
  ]);

  const entriesByUser = new Map<string, DayEntry[]>();
  for (const e of dayEntries as DayEntry[]) {
    const list = entriesByUser.get(e.userId) ?? [];
    list.push(e);
    entriesByUser.set(e.userId, list);
  }
  const staffById = new Map(staff.map((u) => [u.id, u]));

  // Presumidas abertas do dia (todas as SAIDA com a marca e sem
  // correção) — servem de dedupe do lembrete e de fonte do alerta.
  const openPresumed = (saidaEntries as DayEntry[]).filter(
    (e) => isPresumed(e) && e.corrections.length === 0
  );
  const presumedUserIds = new Set(openPresumed.map((e) => e.userId));

  // Canais resolvidos UMA vez por tick.
  const exitTime = settings.pontoExitReminderTime;
  const exitTimeValid = exitTime !== null && EXIT_TIME_RE.test(exitTime);
  const reminderInstant =
    exitTimeValid && exitTime
      ? zonedDateTimeToUtc(tz, range.date, exitTime)
      : null;
  const shouldAskExit =
    reminderInstant !== null && now.getTime() >= reminderInstant.getTime();
  const waChannel = resolveWhatsAppChannel(settings);
  const smsChannels = getSmsConfig(settings);
  const pauseReminderMs = settings.pontoPauseReminderMinutes * 60 * 1000;

  for (const user of staff) {
    const usable = effectiveEntries(entriesByUser.get(user.id) ?? []);
    const last = usable.at(-1);
    try {
      await processUserTick({
        exitTime,
        last,
        log,
        now,
        pauseReminderMs,
        presumedUserIds,
        prisma,
        reminderInstant,
        settings,
        shouldAskExit,
        smsChannels,
        user,
        waChannel,
      });
    } catch (err) {
      log.warn(
        { err, userId: user.id },
        "ponto: lembrete falhou para utilizador"
      );
    }
  }

  // — Alerta ao gestor: presumida aberta e velha (>60 min) —
  for (const presumed of openPresumed) {
    if (
      now.getTime() - presumed.at.getTime() <= EXIT_ALERT_AFTER_MS ||
      exitAlerted.has(presumed.id)
    ) {
      continue;
    }
    exitAlerted.add(presumed.id);
    const worker = staffById.get(presumed.userId);
    await alertManagers(
      prisma,
      wsBroadcast,
      presumed,
      worker?.name ?? worker?.username ?? "um funcionário",
      hhmmAt(tz, presumed.at),
      log
    );
  }
}
