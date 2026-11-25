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
// fresco. Idempotente: a presumida aberta impede duplicados e a marca
// exitAsked+pending distingue "pergunta entregue" de "envio adiado" —
// um envio adiado (modelo Meta por aprovar) re-tenta no tick seguinte
// com a MESMA presumida, nunca grava outra.

import { Role } from "@generated/client";
import type { FastifyBaseLogger } from "fastify";
import { findManyUsers } from "../../repositories/notification.repository.js";
import { findShopSettingsUnique } from "../../repositories/settings.repository.js";
import type { DbClient } from "../../repositories/types.js";
import { isModuleEnabled } from "../../utils/modules.js";
import {
  dayRange,
  localDayRange,
  zonedDateTimeToUtc,
} from "../../utils/time-range.js";
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
import {
  approvedTemplateBodyOf,
  metaConditionalVars,
  orderedTemplateParams,
  syncWhatsAppTemplates,
  TEMPLATE_LANG,
  templateStatusOf,
} from "../whatsapp-templates.service.js";
import { recordPontoEntry } from "./entries.js";
import {
  getPendingPontoExit,
  PONTO_EXIT_PENDING_TTL_MS,
  setPendingPontoExit,
} from "./state.js";
import {
  PONTO_LEMBRETE_TEMPLATE,
  PONTO_TEXT,
  pontoExitReminderText,
} from "./transport.js";

/** >60 min sem correção → alerta aos gestores (spec item 5). */
const EXIT_ALERT_AFTER_MS = 60 * 60 * 1000;
const EXIT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Re-sync de templates Meta despoletado pelo lembrete — no máximo uma
// vez por intervalo para não martelar a Graph a cada worker/tick
// (mesmo critério do TEMPLATE_RESYNC_MIN_MS do outbox).
const PONTO_TEMPLATE_SYNC_MIN_MS = 10 * 60 * 1000;
let lastPontoTemplateSyncAt = 0;

// Dedupes em memória — o processo é único (docker compose); o custo de
// um restart é repetir no máximo um alerta/lembrete por entry aberta.
const pauseReminded = new Set<string>(); // `${userId}:${entryId}`
const exitAlerted = new Set<string>(); // presumedEntryId
// Presumidas cuja pergunta JÁ foi entregue — distingue "enviada e sem
// resposta" de "envio adiado" (modelo Meta por aprovar, canal em falha)
// sem depender do TTL do pending. Um restart re-envia uma vez por
// presumida ainda aberta (efeito aceite, como os outros dedupes).
const exitAsked = new Set<string>(); // presumedEntryId

/** Apenas para testes — esvazia os dedupes entre casos. */
export function clearPontoReminderState(): void {
  pauseReminded.clear();
  exitAlerted.clear();
  exitAsked.clear();
  lastPontoTemplateSyncAt = 0;
}

/** Template do lembrete por aprovar em modo cloud → re-sync throttled
 *  (fire-and-forget): a Cloud submete o modelo à Meta e o estado fica
 *  em whatsappTemplatesJson para a próxima ronda do scheduler. */
function maybeSyncPontoTemplate(
  prisma: DbClient,
  log: FastifyBaseLogger
): void {
  const now = Date.now();
  if (now - lastPontoTemplateSyncAt < PONTO_TEMPLATE_SYNC_MIN_MS) {
    return;
  }
  lastPontoTemplateSyncAt = now;
  syncWhatsAppTemplates(prisma, log).catch((err) =>
    log.warn({ err }, "ponto: sync de templates Meta falhou")
  );
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
  createdAt: Date;
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
    .sort(
      (a, b) =>
        a.at.getTime() - b.at.getTime() ||
        a.createdAt.getTime() - b.createdAt.getTime()
    );
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

/** "YYYY-MM-DD" do dia civil anterior — aritmética sobre a data,
 *  nunca sobre instantes: um dia de 23/25 h na mudança de hora ou
 *  uma meia-noite local repetida não perturbam a conta. */
function prevYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** SMS do ponto — cloud primeiro, local quando a cloud não serve ou
 *  falha de forma definitiva. Lança quando nenhuma via entrega: o
 *  erro sobe ao tick e o envio re-tenta no ciclo seguinte. */
async function sendPontoSms(
  smsChannels: NonNullable<ReturnType<typeof getSmsConfig>>,
  user: StaffUser,
  text: string,
  dedupeId: string,
  countryCode: string
): Promise<void> {
  const to = formatPhone(user.phoneE164 as string, countryCode);
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
    result = await sendSms(
      smsChannels.local,
      user.phoneE164 as string,
      text,
      countryCode
    );
  }
  if (!result?.success) {
    throw new Error(result?.error ?? "SMS falhou");
  }
}

/** Envia texto livre pelo canal do ponto: SMS se permitido E
 *  configurado, senão WhatsApp (Evolution texto; Meta oficial também
 *  aceita freeform dentro da janela de 24 h — a pausa implica mensagem
 *  recente). «Permitir SMS» sem canal SMS na loja cai no WhatsApp em
 *  vez de perder o envio. Devolve false quando nenhum canal aceitou —
 *  o chamador não marca a pergunta como enviada e re-tenta no tick
 *  seguinte. */
async function sendPontoText(
  prisma: DbClient,
  settings: ShopSettings,
  waChannel: ReturnType<typeof resolveWhatsAppChannel>,
  smsChannels: ReturnType<typeof getSmsConfig>,
  user: StaffUser,
  text: string,
  dedupeId: string
): Promise<boolean> {
  const phone = user.phoneE164;
  if (!phone) {
    return false;
  }
  if (user.pontoSmsAllowed && smsChannels) {
    await sendPontoSms(smsChannels, user, text, dedupeId, settings.countryCode);
    return true;
  }
  if (!waChannel) {
    return false;
  }
  const result = await sendWhatsAppText(
    prisma,
    waChannel,
    phone,
    text,
    settings.countryCode,
    settings
  );
  if (!result.success) {
    throw new Error(result.error ?? "WhatsApp falhou");
  }
  return true;
}

/** Lembrete de saída: business-initiated — Evolution recebe texto
 *  livre; o oficial Meta exige o template aprovado `ponto_lembrete`
 *  (única via fora da janela de 24 h). SMS quando pontoSmsAllowed.
 *  `exitTime` é a hora presumida perguntada ao trabalhador (a hora
 *  configurada, ou a última marcação se esta for posterior).
 *  `sent` true quando a pergunta saiu — false quando ficou adiada
 *  (sem telefone/canal, modelo Meta por aprovar): o chamador re-tenta
 *  no próximo tick com a mesma presumida. `messageId` é o id da
 *  mensagem enviada quando o canal o devolve — vai no pending para a
 *  resposta citada se correlacionar com a pergunta ativa. */
async function sendExitReminder(
  prisma: DbClient,
  settings: ShopSettings,
  waChannel: ReturnType<typeof resolveWhatsAppChannel>,
  smsChannels: ReturnType<typeof getSmsConfig>,
  user: StaffUser,
  exitTime: string,
  log: FastifyBaseLogger,
  dedupeId: string
): Promise<{ messageId?: string; sent: boolean }> {
  const phone = user.phoneE164;
  if (!phone) {
    return { sent: false };
  }
  const countryCode = settings.countryCode;
  if (user.pontoSmsAllowed && smsChannels) {
    // SMS só quando há canal configurado — «Permitir SMS» sem canal
    // cai no WhatsApp em baixo: Evolution texto livre, oficial Meta
    // com o template aprovado. NUNCA texto livre no oficial — fora
    // da janela de 24 h a Meta rejeita e o trabalhador não recebe
    // nem pode responder (o template é a única via business-
    // initiated).
    await sendPontoSms(
      smsChannels,
      user,
      pontoExitReminderText(exitTime),
      dedupeId,
      countryCode
    );
    return { sent: true };
  }
  if (!waChannel) {
    return { sent: false };
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
    return { messageId: result.messageId, sent: true };
  }
  // Oficial Meta (local ou relay cloud): o nome resolve-se na BD —
  // a loja pode ter renomeado o modelo nas Definições antes da
  // aprovação (o {{exitTime}} é o contrato estável); sem isto o sync
  // submetia um nome e o lembrete enviava outro. Sem linha (modelo
  // apagado) cai no nome seed — a Meta rejeita como erro normal.
  const tpl = await prisma.notificationTemplate.findFirst({
    orderBy: { name: "asc" },
    select: { body: true, name: true },
    where: { body: { contains: "{{exitTime}}" }, channel: "WHATSAPP" },
  });
  const templateName = tpl?.name ?? PONTO_LEMBRETE_TEMPLATE;
  if (waChannel.mode === "cloud") {
    // Cloud gere a submissão: se o modelo ainda não está APPROVED
    // (lembrete ativado agora, rename por submeter) dispara o re-sync
    // throttled e adia o envio — enviar já falhava na Graph e a
    // próxima ronda do scheduler já lê o estado atualizado e re-tenta
    // a entrega com a mesma presumida.
    const status = templateStatusOf(settings, templateName);
    if (status !== "APPROVED") {
      log.warn(
        { status, template: templateName, userId: user.id },
        "ponto: lembrete adiado — template Meta por aprovar"
      );
      maybeSyncPontoTemplate(prisma, log);
      return { sent: false };
    }
  }
  // Modo oficial local: a app não gere modelos na Meta — a loja cria o
  // template à mão no Business Manager (o estado aparece nas
  // Definições → Notificações) e o envio falha como erro normal se
  // faltar ou não estiver aprovado.
  const orderBody =
    (waChannel.mode === "cloud"
      ? approvedTemplateBodyOf(settings, templateName)
      : null) ?? tpl?.body;
  // Os params seguem o corpo que a aprovação cobre (o outbox faz o
  // mesmo): uma edição local posterior não pode trocar a ordem
  // posicional da versão que a Meta tem.
  const params = orderBody
    ? orderedTemplateParams(
        orderBody,
        { exitTime, shopName: settings.shopName ?? "" },
        metaConditionalVars(settings)
      )
    : [exitTime];
  const result = await sendWhatsAppTemplateVia(
    prisma,
    waChannel,
    phone,
    templateName,
    TEMPLATE_LANG,
    params,
    countryCode,
    settings
  );
  if (!result.success) {
    throw new Error(result.error ?? "template WhatsApp falhou");
  }
  return { messageId: result.messageId, sent: true };
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
  dayStart: Date;
  exitTime: string | null;
  last: DayEntry | undefined;
  log: FastifyBaseLogger;
  now: Date;
  /** Presumida aberta mais recente por utilizador — dedupe do lembrete
   *  e ponto de retoma de um envio adiado. */
  openPresumedByUser: Map<string, DayEntry>;
  pauseReminderMs: number;
  prisma: DbClient;
  reminderInstant: Date | null;
  settings: ShopSettings;
  /** Última ENTRADA/VOLTEI efetiva — a abertura do turno que a
   *  presumida fecha (vai no pending para o handler resolver o dia
   *  de uma hora declarada depois da meia-noite). */
  shiftOpenAt: Date | undefined;
  shouldAskExit: boolean;
  smsChannels: ReturnType<typeof getSmsConfig>;
  tz: string;
  user: StaffUser;
  waChannel: ReturnType<typeof resolveWhatsAppChannel>;
}

/** Proofs da SAIDA presumida — a abertura do turno viaja na própria
 *  linha porque a retoma depois da meia-noite já não tem a entrada nas
 *  marcações de hoje (o pending precisa dela para vedar saídas
 *  anteriores à entrada). */
function presumedProofs(
  shiftOpenAt: Date | undefined
): Record<string, unknown> {
  return {
    exitReminderPresumed: true,
    ...(shiftOpenAt
      ? { exitReminderShiftOpenAt: shiftOpenAt.toISOString() }
      : {}),
  };
}

/** Abertura do turno gravada na presumida (proofs) — a retoma depois
 *  da meia-noite não tem a entrada do turno nas marcações de hoje, por
 *  isso o limite viaja na própria linha desde a criação. */
function presumedShiftOpenAt(presumed: DayEntry): string | null {
  const p = presumed.proofs;
  const v =
    typeof p === "object" && p !== null
      ? (p as Record<string, unknown>).exitReminderShiftOpenAt
      : null;
  return typeof v === "string" ? v : null;
}

/** Retoma o envio de uma pergunta que ficou adiada (modelo Meta por
 *  aprovar, canal em falha, restart): reutiliza a presumida aberta do
 *  turno em curso e só abre a janela de resposta quando o envio pega. */
async function retryDeferredExitReminder(
  a: UserTickArgs,
  presumed: DayEntry
): Promise<void> {
  const {
    log,
    now,
    prisma,
    reminderInstant,
    settings,
    shiftOpenAt,
    smsChannels,
    tz,
    user,
    waChannel,
  } = a;
  // Lembrete desligado nas definições (hora apagada → null): uma
  // pergunta adiada já não deve sair — a presumida fica POR_VALIDAR
  // para o painel e o alerta ao gestor continua independente.
  if (!reminderInstant) {
    return;
  }
  if (
    user.externalWork ||
    exitAsked.has(presumed.id) ||
    getPendingPontoExit(user.id, now.getTime()) ||
    !user.phoneE164 ||
    !(waChannel || (user.pontoSmsAllowed && smsChannels))
  ) {
    return;
  }
  const result = await sendExitReminder(
    prisma,
    settings,
    waChannel,
    smsChannels,
    user,
    hhmmAt(tz, presumed.at),
    log,
    `ponto-exit-${presumed.id}`
  );
  if (result.sent) {
    exitAsked.add(presumed.id);
    // A abertura gravada na presumida ganha ao turno de HOJE: na retoma
    // depois da meia-noite o `shiftOpenAt` do tick é o turno novo (ou
    // nada) — o pendente tem de vedar saídas anteriores à entrada do
    // turno que a presumida fecha, que é o da própria presumida.
    const openAt = presumedShiftOpenAt(presumed) ?? shiftOpenAt?.toISOString();
    setPendingPontoExit(user.id, {
      expiresAt: now.getTime() + PONTO_EXIT_PENDING_TTL_MS,
      presumedAt: presumed.at.toISOString(),
      presumedEntryId: presumed.id,
      ...(result.messageId ? { sentMessageIds: [result.messageId] } : {}),
      ...(openAt ? { shiftOpenAt: openAt } : {}),
      userId: user.id,
    });
  }
}

/** Lembrete de saída (Esquecimentos): grava a SAIDA presumida (se ainda
 *  não saiu) e envia a pergunta pelo canal disponível. A janela de
 *  resposta só abre quando a pergunta é de facto entregue. */
async function processExitReminder(a: UserTickArgs): Promise<void> {
  const {
    dayStart,
    exitTime,
    last,
    log,
    now,
    prisma,
    reminderInstant,
    settings,
    shiftOpenAt,
    shouldAskExit,
    smsChannels,
    tz,
    user,
    waChannel,
  } = a;

  // Presumida aberta do turno em curso (a presumida é uma SAIDA, por
  // isso pertence ao turno aberto só se for posterior à abertura — uma
  // presumida de um turno anterior não bloqueia nem é re-perguntada).
  const prior = a.openPresumedByUser.get(user.id);
  if (prior && (!shiftOpenAt || prior.at.getTime() >= shiftOpenAt.getTime())) {
    await retryDeferredExitReminder(a, prior);
    return;
  }

  if (
    !(
      shouldAskExit &&
      exitTime &&
      reminderInstant &&
      !user.externalWork &&
      last &&
      last.type !== "SAIDA"
    )
  ) {
    return;
  }
  // Re-leitura à chegada: a lista do dia foi lida em lote no início
  // do tick e o envio a cada colega demora — uma SAIDA real
  // registada entretanto (bot, painel) não estava lá e gravava-se
  // uma segunda saída sem ligação à primeira. Só contam saídas que
  // possam fechar o turno EM ABERTO — uma saída de um turno anterior
  // (saiu e voltou a entrar) não cancela o lembrete.
  const alreadyOut = await prisma.timeEntry.findFirst({
    select: { id: true },
    where: {
      at: {
        gte: dayStart,
        // O teto é o instante do tick, não o fim do dia civil: uma
        // correção pode empurrar a saída para depois da meia-noite
        // (a resposta à presumida das 23:55 declara 00:30) — conta
        // na mesma para fechar o turno, senão a recuperação da
        // véspera gravava uma segunda presumida sobre ela.
        lt: now,
        ...(shiftOpenAt ? { gt: shiftOpenAt } : {}),
      },
      corrections: { none: {} },
      type: "SAIDA",
      userId: user.id,
      validations: { none: { decision: "RECUSADO" } },
    },
  });
  if (alreadyOut) {
    return;
  }
  // Nunca antes da última marcação efetiva: quem entra DEPOIS da
  // hora configurada (turno tardio) recebia uma saída presumida
  // anterior à entrada e o turno ficava por fechar.
  const presumedAt =
    last.at.getTime() > reminderInstant.getTime() ? last.at : reminderInstant;
  const presumed = await recordPontoEntry(prisma, {
    at: presumedAt,
    proofs: presumedProofs(shiftOpenAt),
    reason: "saída presumida — lembrete de saída",
    status: "POR_VALIDAR",
    transport: "MANUAL",
    type: "SAIDA",
    userId: user.id,
  });
  if (waChannel || (user.pontoSmsAllowed && smsChannels)) {
    // A pergunta usa a hora presumida real — o SIM confirma
    // exatamente o instante gravado. Envio adiado (modelo por
    // aprovar) não abre a janela — o próximo tick re-tenta.
    const result = await sendExitReminder(
      prisma,
      settings,
      waChannel,
      smsChannels,
      user,
      hhmmAt(tz, presumedAt),
      log,
      `ponto-exit-${presumed.id}`
    );
    if (result.sent) {
      exitAsked.add(presumed.id);
      setPendingPontoExit(user.id, {
        expiresAt: now.getTime() + PONTO_EXIT_PENDING_TTL_MS,
        presumedAt: presumedAt.toISOString(),
        presumedEntryId: presumed.id,
        ...(result.messageId ? { sentMessageIds: [result.messageId] } : {}),
        ...(shiftOpenAt ? { shiftOpenAt: shiftOpenAt.toISOString() } : {}),
        userId: user.id,
      });
    }
  } else {
    log.warn(
      { userId: user.id },
      "ponto: sem canal para lembrete de saída — presumida fica POR_VALIDAR"
    );
  }
}

/** Um utilizador num tick: lembrete de saída (Esquecimentos) e/ou de
 *  pausa (§2.2b). Erros sobem para o try/catch do chamador. */
async function processUserTick(a: UserTickArgs): Promise<void> {
  const {
    last,
    now,
    pauseReminderMs,
    prisma,
    settings,
    smsChannels,
    user,
    waChannel,
  } = a;

  await processExitReminder(a);

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

interface UserPassesArgs {
  catchUpYesterday: boolean;
  end: Date;
  entriesByUser: Map<string, DayEntry[]>;
  exitTime: string | null;
  log: FastifyBaseLogger;
  now: Date;
  openPresumedByUser: Map<string, DayEntry>;
  pauseReminderMs: number;
  prevRange: { start: Date };
  prevReminderInstant: Date | null;
  prisma: DbClient;
  reminderInstant: Date | null;
  settings: ShopSettings;
  shouldAskExit: boolean;
  smsChannels: ReturnType<typeof getSmsConfig>;
  start: Date;
  tz: string;
  user: StaffUser;
  waChannel: ReturnType<typeof resolveWhatsAppChannel>;
}

/** Os passes de um utilizador num tick: primeiro a recuperação da
 *  véspera (hora de lembrete caída entre o último ciclo do dia e a
 *  meia-noite — processada com as marcações do dia civil dela) e
 *  depois o passe normal do dia corrente. */
async function processUserPasses(p: UserPassesArgs): Promise<void> {
  const usableAll = effectiveEntries(p.entriesByUser.get(p.user.id) ?? []);
  const startMs = p.start.getTime();
  const usable = usableAll.filter((e) => e.at.getTime() >= startMs);
  const last = usable.at(-1);
  // Abertura do turno que a presumida fecha — última ENTRADA/VOLTEI
  // efetiva (uma PAUSA a meio não fecha a abertura).
  const shiftOpenAt = [...usable]
    .reverse()
    .find((e) => e.type === "ENTRADA" || e.type === "VOLTEI")?.at;
  const base = {
    exitTime: p.exitTime,
    log: p.log,
    now: p.now,
    openPresumedByUser: p.openPresumedByUser,
    pauseReminderMs: p.pauseReminderMs,
    prisma: p.prisma,
    settings: p.settings,
    smsChannels: p.smsChannels,
    tz: p.tz,
    user: p.user,
    waChannel: p.waChannel,
  };
  if (p.catchUpYesterday) {
    const yestUsable = usableAll.filter((e) => e.at.getTime() < startMs);
    const yLast = yestUsable.at(-1);
    const yShiftOpenAt = [...yestUsable]
      .reverse()
      .find((e) => e.type === "ENTRADA" || e.type === "VOLTEI")?.at;
    await processExitReminder({
      ...base,
      dayStart: p.prevRange.start,
      last: yLast,
      reminderInstant: p.prevReminderInstant,
      shiftOpenAt: yShiftOpenAt,
      shouldAskExit: true,
    });
  }
  await processUserTick({
    ...base,
    dayStart: p.start,
    last,
    reminderInstant: p.reminderInstant,
    shiftOpenAt,
    shouldAskExit: p.shouldAskExit,
  });
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
  // A janela cobre também o dia civil anterior: a hora configurada
  // pode cair entre o último ciclo do dia e a meia-noite (ex.: ciclos
  // 23:46/00:01 com lembrete às 23:55) — o ciclo seguinte tem de
  // recuperar a véspera com as marcações do dia dela.
  const prevRange = localDayRange(tz, prevYmd(range.date));
  const [dayEntries, saidaEntries] = await Promise.all([
    staffIds.length
      ? prisma.timeEntry.findMany({
          orderBy: [{ at: "asc" }, { createdAt: "asc" }],
          select: {
            at: true,
            corrections: { select: { id: true }, take: 1 },
            createdAt: true,
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
          where: {
            at: { gte: prevRange.start, lt: end },
            userId: { in: staffIds },
          },
        })
      : Promise.resolve([]),
    // As SAIDA cobrem também o dia anterior: uma presumida aberta de
    // ontem continua a precisar de retoma (envio adiado às 23:50 cuja
    // aprovação chega já depois da meia-noite) e do alerta ao gestor —
    // limitar ao dia civil corrente esquecia-a à passagem da meia-noite.
    // O limite é o INÍCIO do dia civil anterior — calculado sobre a
    // DATA CIVIL de hoje menos um dia (localDayRange), nunca sobre o
    // instante: recuar milissegundos antes do start falha quando a
    // meia-noite local se repete (recuo de hora — em Atlantic/Azores
    // a 2.ª meia-noite de 25/10/2026 é 01:00Z e start−1ms ainda cai
    // em 25/10); subtrair 24 h também erra nos dias de 23/25 h.
    prisma.timeEntry.findMany({
      orderBy: [{ at: "asc" }, { createdAt: "asc" }],
      select: {
        at: true,
        corrections: { select: { id: true }, take: 1 },
        createdAt: true,
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
      where: {
        at: { gte: localDayRange(tz, prevYmd(range.date)).start, lt: end },
        type: "SAIDA",
      },
    }),
  ]);

  const entriesByUser = new Map<string, DayEntry[]>();
  for (const e of dayEntries as DayEntry[]) {
    const list = entriesByUser.get(e.userId) ?? [];
    list.push(e);
    entriesByUser.set(e.userId, list);
  }
  const staffById = new Map(staff.map((u) => [u.id, u]));

  // Presumidas abertas de hoje e ontem (todas as SAIDA com a marca e
  // sem correção) — servem de dedupe do lembrete, de retoma de um
  // envio adiado e de fonte do alerta. O mapa guarda a mais recente
  // por utilizador (a lista vem por at+createdAt asc).
  const openPresumed = (saidaEntries as DayEntry[]).filter(
    (e) => isPresumed(e) && e.corrections.length === 0
  );
  const openPresumedByUser = new Map<string, DayEntry>();
  for (const e of openPresumed) {
    openPresumedByUser.set(e.userId, e);
  }

  // Canais resolvidos UMA vez por tick.
  const exitTime = settings.pontoExitReminderTime;
  const exitTimeValid = exitTime !== null && EXIT_TIME_RE.test(exitTime);
  const reminderInstant =
    exitTimeValid && exitTime
      ? zonedDateTimeToUtc(tz, range.date, exitTime)
      : null;
  const shouldAskExit =
    reminderInstant !== null && now.getTime() >= reminderInstant.getTime();
  // Hora de lembrete da véspera — quando passou sem ciclo que a
  // apanhasse (janela entre o último ciclo do dia e a meia-noite),
  // o ciclo de hoje recupera-a com as marcações do dia civil dela.
  const prevReminderInstant =
    exitTimeValid && exitTime
      ? zonedDateTimeToUtc(tz, prevYmd(range.date), exitTime)
      : null;
  // …mas só dentro da janela em que a resposta ainda serviria (o
  // TTL do pending, ~2 h): passado esse tempo o comboio já partiu —
  // ativar o lembrete de manhã não pode preencher retroativamente o
  // dia de ontem, quando a configuração nem existia.
  const catchUpYesterday =
    prevReminderInstant !== null &&
    now.getTime() >= prevReminderInstant.getTime() &&
    now.getTime() - prevReminderInstant.getTime() <=
      PONTO_EXIT_PENDING_TTL_MS &&
    now.getTime() < end.getTime();
  const waChannel = resolveWhatsAppChannel(settings);
  const smsChannels = getSmsConfig(settings);
  const pauseReminderMs = settings.pontoPauseReminderMinutes * 60 * 1000;

  for (const user of staff) {
    try {
      await processUserPasses({
        catchUpYesterday,
        end,
        entriesByUser,
        exitTime,
        log,
        now,
        openPresumedByUser,
        pauseReminderMs,
        prevRange,
        prevReminderInstant,
        prisma,
        reminderInstant,
        settings,
        shouldAskExit,
        smsChannels,
        start,
        tz,
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
  await alertOverduePresumed({
    log,
    now,
    openPresumed,
    prisma,
    staffById,
    tz,
    wsBroadcast,
  });
}

/** Varre as presumidas abertas e alerta os gestores das que têm mais
 *  de 60 min sem correção — uma vez por linha (exitAlerted). Linha já
 *  decidida na validação não alerta: a aprovação no painel não cria
 *  correção, por isso fica em openPresumed e sem este filtro o
 *  agendador pedia atenção para algo que o gestor já decidiu. */
async function alertOverduePresumed(a: {
  log: FastifyBaseLogger;
  now: Date;
  openPresumed: DayEntry[];
  prisma: DbClient;
  staffById: Map<string, StaffUser>;
  tz: string;
  wsBroadcast?: Parameters<typeof notify>[0]["wsBroadcast"];
}): Promise<void> {
  const { log, now, openPresumed, prisma, staffById, tz, wsBroadcast } = a;
  for (const presumed of openPresumed) {
    if (
      now.getTime() - presumed.at.getTime() <= EXIT_ALERT_AFTER_MS ||
      exitAlerted.has(presumed.id) ||
      presumed.validations.length > 0
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
