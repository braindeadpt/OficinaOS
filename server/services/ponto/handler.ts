// Handler do livro de ponto — máquina de estados dos fluxos do plano
// §2. Chamado no TOPO de handleInboundMessage (antes da inbox de
// clientes) e no processParsed da Evolution (antes do gate de clientes):
// um telefone de funcionário com pontoEnabled NUNCA chega ao bot de
// clientes, à IA nem à caixa de entrada.
//
// Devolve true quando o remetente é staff ponto — mesmo que a mensagem
// não tenha gerado comando (PARAR, lixo, foto fora de tempo): o
// funcionário nunca "cai" no pipeline de clientes.

import type { TimeEntryTransport, TimeEntryType } from "@generated/client";
import { getOrCreateShopSettings } from "../../repositories/settings.repository.js";
import { isModuleEnabled } from "../../utils/modules.js";
import { fetchPublicMedia } from "../../utils/safe-url.js";
import { dayRange, zonedDateTimeToUtc } from "../../utils/time-range.js";
import type {
  BotReplyCtx,
  InboundMessage,
  InboundTransport,
} from "../bot-intents.js";
import {
  downloadEvolutionMedia,
  type EvolutionConfig,
} from "../evolution.service.js";
import { rateOk } from "../rate-limit.js";
import {
  normalizePontoText,
  type PontoCommand,
  parsePontoCommand,
} from "./commands.js";
import {
  deletePontoPhoto,
  findOpenPresumedExit,
  linkPontoPhoto,
  pontoEntriesSince,
  recordPontoEntry,
  savePontoPhotoFile,
  todayPontoEntries,
} from "./entries.js";
import { evaluatePontoMark } from "./evaluate.js";
import { parsePontoExitAnswer } from "./exit-answer.js";
import { findPontoStaff, type PontoStaffMatch } from "./staff.js";
import {
  clearPendingPonto,
  clearPendingPontoExit,
  getPendingPonto,
  getPendingPontoExit,
  type PendingPonto,
  type PendingPontoExit,
  PONTO_LOCATION_TTL_MS,
  PONTO_PHOTO_TTL_MS,
  pontoPendingKey,
  setPendingPonto,
  setPendingPontoExit,
  takeExpiredPonto,
} from "./state.js";
import {
  PONTO_EXIT_DATE_TERMS,
  PONTO_TEXT,
  pontoExitDateQuestion,
  pontoExitReminderText,
  pontoLocationRequestInteractive,
  pontoNextButtons,
  pontoNextHintText,
  pontoReplyButtonsInteractive,
} from "./transport.js";

type PontoMarkCommand = Exclude<PontoCommand, "ESTADO">;
type Settings = Awaited<ReturnType<typeof getOrCreateShopSettings>>;
type Say = (text: string) => Promise<boolean>;
/** Como Say mas devolve o id da mensagem quando o canal o expõe — as
 *  perguntas do fluxo de saída associam-no ao pending para a citação
 *  do trabalhador apontar para a mensagem certa. */
type SayWithId = (
  text: string
) => Promise<{ messageId?: string; success: boolean }>;
type SayInteractive = (
  interactive: Record<string, unknown>,
  fallbackText: string
) => Promise<void>;

const ENTRY_TYPE_PT: Record<PontoMarkCommand, string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  SAIDA: "Saída",
  VOLTEI: "Regresso",
};

const NAME_WS_RE = /\s+/;
// Qualquer dígito no texto — uma resposta SAÍDA com números que não
// dão hora única é resposta ambígua ao lembrete, não comando.
const ANY_DIGIT_RE = /\d/;

const ENTRY_ICON: Record<PontoMarkCommand, string> = {
  ENTRADA: "✅",
  PAUSA: "⏸️",
  SAIDA: "👋",
  VOLTEI: "▶️",
};

const TRANSPORT_ENUM: Record<
  NonNullable<InboundTransport["ponto"]>["transport"],
  TimeEntryTransport
> = {
  sms: "SMS",
  whatsapp_evolution: "WHATSAPP_EVOLUTION",
  whatsapp_meta: "WHATSAPP_META",
};

export interface PontoHandlerOpts {
  /** Config Evolution para download de foto (só canal evolution). */
  evolution?: EvolutionConfig;
  /** Download da foto — por omissão: getBase64FromMediaMessage na
   *  Evolution (raw) ou GET direto no url. Injetável em testes. */
  fetchPhoto?: (
    ref: NonNullable<InboundMessage["imageRef"]>
  ) => Promise<{ buffer: Buffer; mimetype?: string | null } | null>;
  /** Settings já carregadas pelo caller (o caminho Evolution já as tem). */
  shopSettings?: Settings;
}

interface PhotoData {
  buffer: Buffer;
  mimetype?: string | null;
}

function firstNameOf(user: PontoStaffMatch["user"]): string {
  const name = user.name?.trim();
  if (name) {
    return name.split(NAME_WS_RE)[0];
  }
  return user.username || "";
}

function hhmm(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: tz,
  }).format(at);
}

function fmtHours(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Intervalos fechados dentro de um só conjunto de registos: ENTRADA/
 *  VOLTEI abrem (o primeiro marca ganha se houver duplicados),
 *  PAUSA/SAIDA fecham. Um turno ainda aberto não conta — "horas
 *  trabalhadas" exclui o presente. */
function workedIntervalsMs(entries: { at: Date; type: string }[]): number {
  let total = 0;
  let open: number | null = null;
  for (const e of entries) {
    const t = e.at.getTime();
    if (e.type === "ENTRADA" || e.type === "VOLTEI") {
      if (open === null) {
        open = t;
      }
    } else if (open !== null) {
      total += t - open;
      open = null;
    }
  }
  return total;
}

/** Soma os intervalos fechados POR DIA CIVIL da loja. Uma entrada sem
 *  saída não atravessa a meia-noite: sem o agrupamento, a entrada de
 *  terça era absorvida pelo turno de segunda e a saída de terça fechava
 *  um intervalo de ~32 h (a regra "entrada no próprio dia" já impede
 *  turnos overnight — §2.2). Exceção com ligação: uma CORREÇÃO herda o
 *  dia civil da linha que substitui — a saída corrigida para depois da
 *  meia-noite continua a fechar o turno do dia em que abriu (o `at` da
 *  presumida é a âncora), senão entrada e saída caíam em grupos
 *  separados e as horas sumiam. Exportada para testes. */
export function workedMs(
  entries: { at: Date; corrects?: { at: Date } | null; type: string }[],
  tz: string
): number {
  const byDay = new Map<string, { at: Date; type: string }[]>();
  for (const e of entries) {
    const day = dayRange(tz, e.corrects?.at ?? e.at).date;
    const list = byDay.get(day);
    if (list) {
      list.push(e);
    } else {
      byDay.set(day, [e]);
    }
  }
  let total = 0;
  for (const dayEntries of byDay.values()) {
    total += workedIntervalsMs(dayEntries);
  }
  return total;
}

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ymd ("YYYY-MM-DD") da data UTC — usada para comparar dias civis da
 *  loja independentemente do instante. */
function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** ymd deslocado N dias civis — aritmética sobre a data civil (UTC),
 *  imune a DST: somar 24 h ao instante saltava o dia inteiro na
 *  transição para a hora de verão. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return utcYmd(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Segunda-feira 00:00 do fuso da loja — base do "horas da semana".
 *  O dia civil local não tem 24 h exatas (DST), por isso retrocede-se
 *  por instantes e valida-se a data local até cair na segunda. */
function weekStart(tz: string, now: Date): Date {
  const { date } = dayRange(tz, now);
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (dow + 6) % 7;
  const targetYmd = utcYmd(new Date(Date.UTC(y, m - 1, d - back)));
  let candidate = new Date(now.getTime() - back * DAY_MS);
  for (let i = 0; i < 3; i++) {
    const r = dayRange(tz, candidate);
    if (r.date === targetYmd) {
      return r.start;
    }
    candidate = new Date(candidate.getTime() - DAY_MS);
  }
  return dayRange(tz, candidate).start;
}

function pauseMinutesOf(
  pauseSinceAt: string | undefined,
  at: Date
): number | null {
  if (!pauseSinceAt) {
    return null;
  }
  const ms = at.getTime() - Date.parse(pauseSinceAt);
  return ms >= 0 ? Math.round(ms / 60_000) : null;
}

function confirmationText(
  command: PontoMarkCommand,
  at: Date,
  tz: string,
  firstName: string,
  pauseMinutes: number | null,
  status: "APROVADO" | "POR_VALIDAR",
  reason?: string
): string {
  if (status === "POR_VALIDAR") {
    return `⚠️ Registado — pendente de validação${reason ? ` (${reason})` : ""}.`;
  }
  const pauseSuffix =
    command === "VOLTEI" && pauseMinutes !== null
      ? ` (pausa de ${pauseMinutes} min)`
      : "";
  const who = firstName ? `, ${firstName}` : "";
  return `${ENTRY_ICON[command]} ${ENTRY_TYPE_PT[command]} às ${hhmm(at, tz)}${pauseSuffix}${who}.`;
}

function recusadoText(reason?: string): string {
  return reason
    ? `Não consegui registar o ponto — ${reason}.`
    : "Não consegui registar o ponto — tente outra vez ou leia o QR.";
}

async function defaultFetchPhoto(
  ref: NonNullable<InboundMessage["imageRef"]>,
  opts?: PontoHandlerOpts
): Promise<PhotoData | null> {
  if (opts?.evolution && ref.raw) {
    const media = await downloadEvolutionMedia(opts.evolution, ref.raw).catch(
      () => null
    );
    if (media) {
      return {
        buffer: Buffer.from(media.base64, "base64"),
        mimetype: media.mimetype ?? ref.mimetype ?? null,
      };
    }
  }
  if (ref.url) {
    // A URL vem do payload do webhook — controlada por quem o enviou.
    // Sem a guarda SSRF um webhook forjado faria a app pedir serviços
    // internos (metadata, router, loopback). Só https público, ou a
    // origem da instância Evolution configurada.
    const media = await fetchPublicMedia(ref.url, {
      trustedOrigin: opts?.evolution?.baseUrl ?? null,
    });
    if (media) {
      return {
        buffer: media.buffer,
        mimetype: media.contentType ?? ref.mimetype ?? null,
      };
    }
  }
  return null;
}

function fetchPhotoForEntry(
  ref: NonNullable<InboundMessage["imageRef"]>,
  opts?: PontoHandlerOpts
): Promise<PhotoData | null> {
  if (opts?.fetchPhoto) {
    return opts.fetchPhoto(ref).catch(() => null);
  }
  return defaultFetchPhoto(ref, opts);
}

type PontoChannel = NonNullable<InboundTransport["ponto"]>;
type PontoTransportKind = PontoChannel["transport"];

/** Contexto partilhado por todos os passos do fluxo — evita passar
 *  10 parâmetros a cada handler de etapa. */
interface FlowEnv {
  channel: PontoChannel;
  ctx: BotReplyCtx;
  key: string;
  msg: InboundMessage;
  opts?: PontoHandlerOpts;
  phoneDigits: string;
  say: Say;
  sayInteractive: SayInteractive;
  sayWithId: SayWithId;
  settings: Settings;
  staff: PontoStaffMatch;
  transport: PontoTransportKind;
  tz: string;
}

function buildFlowEnv(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport,
  channel: PontoChannel,
  staff: PontoStaffMatch,
  settings: Settings,
  opts?: PontoHandlerOpts
): FlowEnv {
  const transport = channel.transport;
  const say: Say = async (text) => {
    try {
      return await t.send(text);
    } catch {
      return false;
    }
  };
  // Canal sem `sendWithId` (SMS, envio suprimido): envia na mesma, o id
  // fica ausente e a correlação de citação passa a fail-open.
  const sayWithId: SayWithId = async (text) => {
    if (!t.sendWithId) {
      return { success: await say(text) };
    }
    try {
      return await t.sendWithId(text);
    } catch {
      return { success: false };
    }
  };
  const sayInteractive: SayInteractive = async (interactive, fallbackText) => {
    if (channel.interactive) {
      const ok = await channel.interactive(interactive).catch(() => false);
      if (ok) {
        return;
      }
    }
    await say(fallbackText);
  };
  return {
    channel,
    ctx,
    key: pontoPendingKey(transport, staff.phoneDigits),
    msg,
    opts,
    phoneDigits: staff.phoneDigits,
    say,
    sayInteractive,
    sayWithId,
    settings,
    staff,
    transport,
    tz: settings.timezone ?? process.env.TZ ?? "UTC",
  };
}

/** Pendência expirada: foto tardia finaliza com hasPhoto=false (o
 *  registo não se perde — a Cloud decide); localização tardia morre
 *  aqui e o pedido novo recomeça. Devolve o pendente para o branch de
 *  localização distinguir "expirou" de "nunca houve". */
async function finalizeExpiredPhoto(
  env: FlowEnv
): Promise<PendingPonto | null> {
  const expired = takeExpiredPonto(env.key);
  if (expired?.stage !== "photo") {
    return expired ?? null;
  }
  const at = new Date(expired.locationAt ?? expired.commandAt);
  await finalizePonto(
    env.ctx,
    env.say,
    env.sayInteractive,
    env.settings,
    env.staff,
    env.transport,
    {
      at,
      code: expired.command === "ENTRADA" ? expired.code : undefined,
      command: expired.command,
      hasPhoto: false,
      location: expired.location,
      // A espera da foto é janela da APP, não atraso de transporte: a
      // Cloud mede a frescura (≤5 min) sobre messageAt. Com o commandAt
      // original (comando + espera de localização + TTL da foto ≥5 min)
      // toda a marcação sem foto caía em "registo recebido com atraso"
      // — e um externo com auto-aprovação perdia o APROVADO. A hora em
      // que a janela da foto fechou é o instante em que a marcação
      // ficou final: fresco agora, e continua velho se o funcionário
      // só aparecer horas depois (o atraso real preserva-se).
      messageAt: new Date(expired.expiresAt).toISOString(),
      pauseMinutes: pauseMinutesOf(expired.pauseSinceAt, at),
      phoneDigits: env.phoneDigits,
      todayHasEntry: expired.todayHasEntry,
    }
  );
  return expired;
}

/** Localização sem pedido pendente: a resposta certa depende do que
 *  estava à espera (foto), do que acabou de expirar ou de nada. */
function orphanLocationReply(
  pending: PendingPonto | null,
  expired: PendingPonto | null
): string {
  if (pending?.stage === "photo") {
    return PONTO_TEXT.photoPrompt;
  }
  if (expired?.stage === "location") {
    return PONTO_TEXT.locationExpired;
  }
  return PONTO_TEXT.noPendingLocation;
}

async function routeLocation(
  env: FlowEnv,
  expired: PendingPonto | null
): Promise<void> {
  const pending = getPendingPonto(env.key);
  if (pending?.stage === "location") {
    await onLocation(env, pending);
    return;
  }
  await env.say(orphanLocationReply(pending, expired));
}

async function routePhoto(env: FlowEnv): Promise<void> {
  const pending = getPendingPonto(env.key);
  if (pending?.stage === "photo") {
    await onPhoto(env, pending);
    return;
  }
  await env.say(PONTO_TEXT.noPendingPhoto);
}

async function routeText(env: FlowEnv): Promise<void> {
  const parsed = parsePontoCommand(env.msg.text, env.msg.interactiveId);
  const pending = getPendingPonto(env.key);
  if (pending?.stage === "photo" && !parsed) {
    await env.say(PONTO_TEXT.photoPrompt);
    return;
  }
  if (pending?.stage === "location" && !parsed) {
    await askLocation(env.say, env.sayInteractive, env.channel);
    return;
  }
  if (!parsed) {
    // Resposta ao lembrete de saída pendente (item 5): "SIM" ou a hora
    // declarada corrigem a SAIDA presumida. Texto irreconhecível repete
    // a pergunta — o pending só morre com comando, resposta ou TTL.
    const exitPending = getPendingPontoExit(env.staff.user.id);
    if (exitPending && env.msg.text) {
      await onExitReminderAnswer(env, exitPending);
      return;
    }
    await env.say(PONTO_TEXT.commands);
    return;
  }
  // Com pergunta de saída pendente, uma declaração de SAÍDA com hora
  // ("Saí 18:05") responde à pergunta — o parser de comandos lia-a
  // como SAIDA e a hora declarada perdia-se ("Saí às 18:05" já caía
  // aqui por não cobrir "às"). Uma SAÍDA com números que não dão hora
  // única («Saí 18:05-19», «SAIDA 99» — o parser de comandos tolera
  // tokens numéricos soltos) é resposta ambígua, não comando: repete
  // a pergunta em vez de cair no fluxo da SAÍDA, que gravava a hora
  // de receção como correção. O código QR («SAIDA #4821») fica de
  // fora — é comando, não hora. Um token de 4 dígitos pode ser um
  // ANO, não código («09/01/2026 ou 10/01/2026»): a declaração
  // ambígua vai para a pergunta na mesma — só o texto sem hora nem
  // ambiguidade e com código respeita o comando. O desvio vale só
  // para SAIDA: «VOLTEI 18:05» é regresso de pausa e segue o seu
  // fluxo mesmo com hora no texto. Botões e comandos sem hora
  // mantêm a prioridade normal: matam o pending e seguem o fluxo
  // do comando.
  const exitPending = getPendingPontoExit(env.staff.user.id);
  const answer = parsePontoExitAnswer(env.msg.text);
  if (
    exitPending &&
    !env.msg.interactiveId &&
    parsed.command === "SAIDA" &&
    (answer?.kind === "time" ||
      answer?.kind === "ambiguous" ||
      (!parsed.code && ANY_DIGIT_RE.test(env.msg.text ?? "")))
  ) {
    await onExitReminderAnswer(env, exitPending);
    return;
  }
  // Qualquer comando ponto normal mata o pending de saída — a SAIDA
  // seguinte corrige a presumida automaticamente no finalizePonto.
  clearPendingPontoExit(env.staff.user.id);
  clearPendingPonto(env.key);
  await dispatchCommand({
    channel: env.channel,
    ctx: env.ctx,
    key: env.key,
    msg: env.msg,
    parsed,
    phoneDigits: env.phoneDigits,
    say: env.say,
    sayInteractive: env.sayInteractive,
    settings: env.settings,
    staff: env.staff,
    transport: env.transport,
    tz: env.tz,
  });
}

/**
 * Ponto handler — ver docstring do módulo. `t.ponto` ausente → o canal
 * não fala ponto → false (pipeline normal). Erros internos propagam
 * para o catch do caller (bot-intents loga e segue o pipeline normal).
 */
export async function tryHandlePontoStaff(
  ctx: BotReplyCtx,
  msg: InboundMessage,
  t: InboundTransport,
  opts?: PontoHandlerOpts
): Promise<boolean> {
  const channel = t.ponto;
  if (!channel) {
    return false;
  }
  const staff = await findPontoStaff(ctx.prisma, msg.fromPhone);
  if (!staff) {
    return false;
  }
  const settings =
    opts?.shopSettings ?? (await getOrCreateShopSettings(ctx.prisma));
  if (!isModuleEnabled(settings, "ponto")) {
    return false;
  }
  // Flood de um telefone de staff: consome a mensagem na mesma —
  // nunca cai no bot de clientes por rate limit.
  if (!rateOk(msg.fromPhone, 30, "ponto")) {
    return true;
  }

  const env = buildFlowEnv(ctx, msg, t, channel, staff, settings, opts);

  // SMS sem permissão: resposta fixa, sem registo — antes de qualquer
  // outra interpretação (o SMS nunca tem localização/foto).
  if (env.transport === "sms" && !staff.user.pontoSmsAllowed) {
    await env.say("Use o WhatsApp para registar o ponto.");
    return true;
  }

  const expired = await finalizeExpiredPhoto(env);
  if (msg.location) {
    await routeLocation(env, expired);
    return true;
  }
  if (msg.imageRef) {
    await routePhoto(env);
    return true;
  }
  await routeText(env);
  return true;
}

/** Identidade da clarificação servida por uma pergunta — o id só se
 *  liga se ela ainda for a ativa quando o envio acabar: entre o
 *  `setPendingPontoExit` da pergunta e a resolução do `sayWithId` pode
 *  chegar outra hora que a substitua, e associar o id antigo à
 *  clarificação nova gravava a hora que a pergunta citada não tinha. */
function clarifyKey(c: {
  hhmm: string;
  ymdReminder: string;
  ymdReply: string;
}): string {
  return `${c.hhmm}|${c.ymdReminder}|${c.ymdReply}`;
}

/** Envia uma pergunta do fluxo de saída e associa o id devolvido pelo
 *  canal à pendência — a citação (reply-quote) do trabalhador aponta
 *  para a mensagem REAL a que respondeu, não só para o lembrete
 *  inicial: sem isto uma resposta citada à repetição ou à pergunta
 *  ONTEM/HOJE era rejeitada e a pergunta voltava a sair em ciclo.
 *  `clarifyFor` (chave da clarificação que a pergunta serve) faz o id
 *  juntar-se aos `questionMessageIds` DESSA clarificação — se ela foi
 *  substituída durante o envio, o id fica só em `sentMessageIds` e a
 *  citação reenvia a pergunta atual em vez de gravar a hora errada. */
async function askExitQuestion(
  env: FlowEnv,
  text: string,
  clarifyFor?: string
): Promise<void> {
  const res = await env.sayWithId(text);
  if (!res.messageId) {
    return;
  }
  const cur = getPendingPontoExit(env.staff.user.id);
  if (cur) {
    const curClarify = cur.clarifyDate;
    const bound =
      curClarify &&
      clarifyFor !== undefined &&
      clarifyKey(curClarify) === clarifyFor
        ? {
            ...curClarify,
            questionMessageIds: [
              ...(curClarify.questionMessageIds ?? []),
              res.messageId,
            ],
          }
        : curClarify;
    setPendingPontoExit(env.staff.user.id, {
      ...cur,
      clarifyDate: bound,
      sentMessageIds: [...(cur.sentMessageIds ?? []), res.messageId],
    });
  }
}

/**
 * Resposta ao lembrete de saída (item 5): "SIM" confirma a hora
 * presumida (correção APROVADO); uma hora indicada cria correção
 * POR_VALIDAR (autodeclaração divergente). Qualquer outro texto
 * repete a pergunta — o pending continua até resposta clara, comando
 * ponto ou TTL.
 */
/** Dias candidatos da hora declarada filtrados pela data explícita
 *  («23/11») e pelo dia relativo («ontem às 18:05») da resposta. O
 *  relativo resolve-se contra o dia civil da RESPOSTA e intersecta com
 *  os candidatos: sem isto a palavra perdia-se e a hora gravava-se
 *  noutro dia («ontem» dito no próprio dia do turno caía na data do
 *  lembrete). Zero coincidências repete a pergunta com o pending vivo
 *  em vez de gravar no dia errado. */
function wantedAnswerDays(
  ymds: Set<string>,
  answer: {
    date?: { day: number; month: number; year: number | null };
    relativeDay?: number;
  },
  tz: string,
  answerAt: Date
): Set<string> {
  const stated = answer.date;
  let wanted = stated
    ? new Set(
        [...ymds].filter((ymd) => {
          const [y, mo, d] = ymd.split("-").map(Number);
          return (
            d === stated.day &&
            mo === stated.month &&
            (stated.year === null || y === stated.year)
          );
        })
      )
    : ymds;
  if (answer.relativeDay !== undefined) {
    const relYmd = shiftYmd(dayRange(tz, answerAt).date, answer.relativeDay);
    wanted = new Set([...wanted].filter((ymd) => ymd === relYmd));
  }
  return wanted;
}

async function onExitReminderAnswer(
  env: FlowEnv,
  pending: PendingPontoExit
): Promise<void> {
  // Presumida recusada pela gerência: a resposta do trabalhador NUNCA
  // a pode substituir — um «SIM» gravava uma correção APROVADO sobre a
  // linha recusada sem nova decisão do gestor, contornando a recusa.
  // O fluxo fecha e o acerto passa a ser feito no painel.
  const validation = await env.ctx.prisma.timeEntry
    .findFirst({
      select: {
        validations: {
          orderBy: { at: "desc" },
          select: { decision: true },
          take: 1,
        },
      },
      where: { id: pending.presumedEntryId },
    })
    .catch(() => null);
  if (validation?.validations[0]?.decision === "RECUSADO") {
    clearPendingPontoExit(env.staff.user.id);
    await env.say(PONTO_TEXT.exitReminderRejected);
    return;
  }
  // Citação de mensagem (reply-quote do WhatsApp): só aplica a
  // resposta quando a citação aponta para uma pergunta desta pendência
  // (o lembrete inicial ou qualquer repetição/clarificação — cada uma
  // regista o seu id ao sair). Um "SIM" citando um lembrete mais
  // antigo (dois turnos no dia) não pode confirmar a presumida do
  // lembrete novo — a pergunta ativa repete-se para o trabalhador
  // responder sobre a saída certa. Sem ids conhecidos (SMS, relay
  // cloud sem wamid) não há como verificar — fail-open.
  if (
    env.msg.quotedMessageId &&
    pending.sentMessageIds?.length &&
    !pending.sentMessageIds.includes(env.msg.quotedMessageId)
  ) {
    await askExitQuestion(
      env,
      pontoExitReminderText(hhmm(new Date(pending.presumedAt), env.tz))
    );
    return;
  }
  const answer = parsePontoExitAnswer(env.msg.text);
  // Com clarificação de data pendente (ONTEM/HOJE), só uma NOVA hora
  // explícita reabre o cálculo — «SIM», «certo» ou texto solto não
  // escolhem dia nenhum: segue o fluxo da data, que repete a pergunta
  // sem gravar nem limpar o pending.
  if (pending.clarifyDate && answer?.kind !== "time") {
    await onExitDateClarification(env, pending);
    return;
  }
  // Ambíguo ou irreconhecível — repete a pergunta sem gravar nem
  // limpar o pending (nunca confirma a presumida).
  if (!answer || answer.kind === "ambiguous") {
    await askExitQuestion(env, PONTO_TEXT.exitReminderReprompt);
    return;
  }
  // A presumida pode ter sido corrigida entretanto (SAIDA por comando,
  // painel) — nesse caso o pending já não se aplica.
  const stillOpen = await env.ctx.prisma.timeEntry
    .findFirst({
      select: { id: true },
      where: { correctsId: pending.presumedEntryId },
    })
    .catch(() => null);
  if (stillOpen) {
    clearPendingPontoExit(env.staff.user.id);
    await env.say(PONTO_TEXT.commands);
    return;
  }

  const presumedDate = new Date(pending.presumedAt);
  let at = presumedDate;
  let status: "APROVADO" | "POR_VALIDAR" = "APROVADO";
  let reason = "confirmado pelo trabalhador";
  let proofs: Record<string, unknown> = { exitReminderConfirmed: true };
  if (answer.kind === "time") {
    // A resposta pode chegar já no dia seguinte (o pending vive ~2 h —
    // um lembrete das 23:30 respondido às 00:20 declara uma saída do
    // dia da RESPOSTA, não do dia da presumida). Candidatos: esse HH:MM
    // no dia civil da presumida e no dia seguinte; fica o único que
    // seja posterior à abertura do turno (o shiftOpenAt guardado no
    // pending) e não esteja no futuro — zero ou dois plausíveis volta
    // a perguntar em vez de gravar uma data arbitrária.
    const answerAt = new Date(env.msg.sentAt ?? env.msg.createdAt);
    // O dia seguinte é o dia civil a seguir — somar 24 h ao instante
    // salta o dia inteiro na transição para a hora de verão (o dia civil
    // tem 23 h, não 24).
    const presumedDay = dayRange(env.tz, presumedDate);
    const ymds = new Set([
      presumedDay.date,
      dayRange(env.tz, presumedDay.end).date,
    ]);
    // Data declarada («saí 23/11 às 18:05») — só serve quando bate num
    // dos dias candidatos. Se aponta para outro dia, a resposta não é
    // sobre este turno: repete-se a pergunta com o pending vivo em vez
    // de gravar a hora no dia errado.
    const wanted = wantedAnswerDays(ymds, answer, env.tz, answerAt);
    if (wanted.size === 0) {
      await askExitQuestion(env, PONTO_TEXT.exitReminderReprompt);
      return;
    }
    const openAt = pending.shiftOpenAt ? Date.parse(pending.shiftOpenAt) : null;
    const candidates = [...wanted]
      .map((ymd) => zonedDateTimeToUtc(env.tz, ymd, answer.hhmm))
      .filter(
        (d): d is Date =>
          d !== null &&
          d.getTime() <= answerAt.getTime() &&
          (openAt === null || d.getTime() > openAt)
      );
    if (candidates.length === 0) {
      // Impossível (futuro, anterior ao turno) — repete a pergunta
      // com o pending vivo: a resposta seguinte re-tenta.
      await askExitQuestion(env, PONTO_TEXT.exitReminderReprompt);
      return;
    }
    if (candidates.length > 1) {
      // Dois dias plausíveis — nunca se assume: pergunta-se ONTEM/HOJE
      // com o pending vivo (clarifyDate) em vez de gravar ao acaso.
      // wanted tem exatamente os dois dias candidatos por ordem.
      const [ymdReminder, ymdReply] = [...wanted].sort();
      const clarify = { hhmm: answer.hhmm, ymdReminder, ymdReply };
      setPendingPontoExit(env.staff.user.id, {
        ...pending,
        clarifyDate: clarify,
      });
      await askExitQuestion(
        env,
        pontoExitDateQuestion(answer.hhmm, ymdReminder, ymdReply),
        clarifyKey(clarify)
      );
      return;
    }
    at = candidates[0];
    status = "POR_VALIDAR";
    reason = "hora de saída indicada pelo trabalhador";
    proofs = { exitReminderTimeDeclared: true };
  }

  clearPendingPontoExit(env.staff.user.id);
  await recordExitCorrection(env, pending, at, status, reason, proofs);
}

/** Grava a correção da SAIDA presumida e confirma — partilhado pelo
 *  SIM, pela hora declarada e pela escolha ONTEM/HOJE. */
async function recordExitCorrection(
  env: FlowEnv,
  pending: PendingPontoExit,
  at: Date,
  status: "APROVADO" | "POR_VALIDAR",
  reason: string,
  proofs: Record<string, unknown>
): Promise<void> {
  await recordPontoEntry(env.ctx.prisma, {
    at,
    correctsId: pending.presumedEntryId,
    proofs,
    reason,
    status,
    transport: TRANSPORT_ENUM[env.transport],
    type: "SAIDA",
    userId: env.staff.user.id,
  });
  await env.say(
    confirmationText(
      "SAIDA",
      at,
      env.tz,
      firstNameOf(env.staff.user),
      null,
      status,
      reason
    )
  );
}

/** Escolha ONTEM/HOJE à pergunta de data — grava a hora declarada no
 *  dia escolhido (sempre POR_VALIDAR: é autodeclaração). */
async function onExitDateClarification(
  env: FlowEnv,
  pending: PendingPontoExit
): Promise<void> {
  const clarify = pending.clarifyDate;
  if (!clarify) {
    await askExitQuestion(env, PONTO_TEXT.exitReminderReprompt);
    return;
  }
  // Citação a uma pergunta de OUTRA clarificação (a hora ambígua foi
  // substituída entretanto e a citação aponta para a pergunta antiga):
  // gravar ONTEM/HOJE aplicaria a hora da clarificação ativa à pergunta
  // citada — reenvia-se a pergunta atual sem gravar. O mesmo vale para
  // a janela em que a pergunta substituta ainda vai a caminho: enquanto
  // o id não chega, `questionMessageIds` está vazio e nenhuma citação é
  // verificável. A verificação só acontece quando o canal devolve ids
  // (`sentMessageIds` não vazio) — sem ids (SMS) segue como antes,
  // fail-open.
  if (
    env.msg.quotedMessageId &&
    pending.sentMessageIds?.length &&
    !clarify.questionMessageIds?.includes(env.msg.quotedMessageId)
  ) {
    await askExitQuestion(
      env,
      pontoExitDateQuestion(
        clarify.hhmm,
        clarify.ymdReminder,
        clarify.ymdReply
      ),
      clarifyKey(clarify)
    );
    return;
  }
  const normalized = normalizePontoText(env.msg.text ?? "");
  let ymd: string | null = null;
  if (
    normalized === PONTO_EXIT_DATE_TERMS.today ||
    normalized === PONTO_EXIT_DATE_TERMS.now
  ) {
    ymd = clarify.ymdReply;
  } else if (normalized === PONTO_EXIT_DATE_TERMS.yesterday) {
    ymd = clarify.ymdReminder;
  }
  if (!ymd) {
    await askExitQuestion(
      env,
      PONTO_TEXT.exitDateClarifyReprompt,
      clarifyKey(clarify)
    );
    return;
  }
  const stillOpen = await env.ctx.prisma.timeEntry
    .findFirst({
      select: { id: true },
      where: { correctsId: pending.presumedEntryId },
    })
    .catch(() => null);
  clearPendingPontoExit(env.staff.user.id);
  if (stillOpen) {
    await env.say(PONTO_TEXT.commands);
    return;
  }
  const at = zonedDateTimeToUtc(env.tz, ymd, clarify.hhmm);
  if (!at) {
    await askExitQuestion(env, PONTO_TEXT.exitReminderReprompt);
    return;
  }
  await recordExitCorrection(
    env,
    pending,
    at,
    "POR_VALIDAR",
    "hora de saída indicada pelo trabalhador",
    { exitReminderTimeDeclared: true }
  );
}

async function askLocation(
  say: Say,
  sayInteractive: SayInteractive,
  channel: NonNullable<InboundTransport["ponto"]>
): Promise<void> {
  if (channel.interactive) {
    await sayInteractive(
      pontoLocationRequestInteractive(PONTO_TEXT.locationPromptInteractive),
      PONTO_TEXT.locationPromptText
    );
    return;
  }
  await say(PONTO_TEXT.locationPromptText);
}

interface DispatchArgs {
  channel: NonNullable<InboundTransport["ponto"]>;
  ctx: BotReplyCtx;
  key: string;
  msg: InboundMessage;
  parsed: { code?: string; command: PontoCommand };
  phoneDigits: string;
  say: Say;
  sayInteractive: SayInteractive;
  settings: Settings;
  staff: PontoStaffMatch;
  transport: NonNullable<InboundTransport["ponto"]>["transport"];
  tz: string;
}

async function dispatchCommand(a: DispatchArgs): Promise<void> {
  const {
    channel,
    ctx,
    key,
    msg,
    parsed,
    phoneDigits,
    say,
    sayInteractive,
    settings,
    staff,
    transport,
    tz,
  } = a;
  let command = parsed.command;

  if (command === "ESTADO") {
    await replyEstado(ctx, say, staff.user.id, tz);
    return;
  }

  const markCommand = command as PontoMarkCommand;
  const entries = await todayPontoEntries(ctx.prisma, staff.user.id, tz);
  const hasEntrada = entries.some((e) => e.type === "ENTRADA");
  const onPause = entries.at(-1)?.type === "PAUSA";
  const pauseSinceAt = onPause
    ? [...entries]
        .reverse()
        .find((e) => e.type === "PAUSA")
        ?.at.toISOString()
    : undefined;

  // Durante uma pausa contam como regresso VOLTEI… e também ENTRADA
  // (reler o QR) — §2.2b. O código do QR fica por usar e expira.
  if (markCommand === "ENTRADA" && onPause) {
    command = "VOLTEI";
  }
  const effective = command as PontoMarkCommand;

  // PAUSA/VOLTEI/SAIDA exigem entrada registada hoje (§2.2).
  if (effective !== "ENTRADA" && !hasEntrada) {
    await say(PONTO_TEXT.noEntryToday);
    return;
  }

  // SMS: evaluate direto — nunca há localização nem foto; a Cloud
  // devolve sempre POR_VALIDAR para este transporte (§2.3).
  if (transport === "sms") {
    await finalizePonto(ctx, say, sayInteractive, settings, staff, transport, {
      at: new Date(msg.createdAt),
      code:
        effective === "ENTRADA" && !staff.user.externalWork
          ? parsed.code
          : undefined,
      command: effective,
      hasPhoto: false,
      messageAt: msg.sentAt ?? msg.createdAt,
      pauseMinutes: pauseMinutesOf(pauseSinceAt, new Date(msg.createdAt)),
      phoneDigits,
      todayHasEntry: hasEntrada,
    });
    return;
  }

  // Staff de loja: ENTRADA exige o código do QR (o texto do wa.me traz
  // "ENTRADA <slug> #<code>"). Externo entra sem código (§2.4).
  if (!staff.user.externalWork && effective === "ENTRADA" && !parsed.code) {
    await say(PONTO_TEXT.entradaNeedsCode);
    return;
  }

  const wantPhoto = staff.user.externalWork && effective === "ENTRADA";
  const pending: PendingPonto = {
    command: effective,
    // Hora de ENVIO da mensagem de comando quando o canal a expõe
    // (sentAt da Meta na fila oficial; na Evolution o createdAt já é o
    // messageTimestamp do payload) — a Cloud mede a validade do código
    // e a frescura do registo a partir daqui.
    commandAt: msg.sentAt ?? msg.createdAt,
    ...(effective === "ENTRADA" && !staff.user.externalWork && parsed.code
      ? { code: parsed.code }
      : {}),
    expiresAt: Date.now() + PONTO_LOCATION_TTL_MS,
    externalWork: staff.user.externalWork,
    pauseSinceAt,
    stage: "location",
    todayHasEntry: hasEntrada,
    userId: staff.user.id,
    userName: firstNameOf(staff.user),
    wantPhoto,
  };
  setPendingPonto(key, pending);
  await askLocation(say, sayInteractive, channel);
}

interface FinalizeArgs {
  at: Date;
  code?: string;
  command: PontoMarkCommand;
  hasPhoto: boolean;
  location?: PendingPonto["location"];
  messageAt: string;
  pauseMinutes?: number | null;
  phoneDigits: string;
  photoId?: string | null;
  todayHasEntry: boolean;
}

/** Etapa de foto sem foto: ao fim do TTL a marcação finaliza sozinha
 *  com hasPhoto=false — o registo não se perde (§2.1). Timer em memória
 *  como o próprio pending: morre com o processo, efeito aceite. Um
 *  timer velho (pedido substituído) não faz nada — takeExpiredPonto só
 *  devolve pendências já expiradas, e a foto a tempo limpa o pending
 *  antes do timer disparar. */
function schedulePhotoExpiry(env: FlowEnv, expiresAt: number): void {
  const timer = setTimeout(
    () => {
      finalizeExpiredPhoto(env).catch((err) =>
        env.ctx.log.warn({ err }, "ponto: TTL da foto — finalização falhou")
      );
    },
    Math.max(0, expiresAt - Date.now())
  );
  if (timer.unref) {
    timer.unref();
  }
}

async function onLocation(env: FlowEnv, pending: PendingPonto): Promise<void> {
  const {
    ctx,
    key,
    msg,
    phoneDigits,
    say,
    sayInteractive,
    settings,
    staff,
    transport,
  } = env;
  const loc = msg.location;
  if (!(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng))) {
    await say(PONTO_TEXT.locationPromptText);
    return;
  }
  pending.location = {
    lat: loc.lat,
    lng: loc.lng,
    ...(loc.accuracy === undefined ? {} : { accuracy: loc.accuracy }),
  };
  pending.locationAt = msg.createdAt;
  if (pending.wantPhoto) {
    pending.stage = "photo";
    pending.expiresAt = Date.now() + PONTO_PHOTO_TTL_MS;
    setPendingPonto(key, pending);
    schedulePhotoExpiry(env, pending.expiresAt);
    await say(PONTO_TEXT.photoPrompt);
    return;
  }
  // O pedido morre ANTES de avaliar — sem isto uma segunda partilha de
  // localização reencontrava-o e gravava outra marcação (dedupe, como
  // onPhoto já faz).
  clearPendingPonto(key);
  await finalizePonto(ctx, say, sayInteractive, settings, staff, transport, {
    at: new Date(pending.locationAt),
    code: pending.command === "ENTRADA" ? pending.code : undefined,
    command: pending.command,
    hasPhoto: false,
    location: pending.location,
    // Com código QR em jogo (ENTRADA de loja) a hora do comando fica —
    // é dela que a Cloud mede a validade do código. Sem código (fluxos
    // de externos) a frescura mede-se da última interação, como no
    // onPhoto: a espera da localização é janela da app, não atraso de
    // transporte.
    messageAt: pending.code ? pending.commandAt : (msg.sentAt ?? msg.createdAt),
    pauseMinutes: pauseMinutesOf(
      pending.pauseSinceAt,
      new Date(pending.locationAt)
    ),
    phoneDigits,
    todayHasEntry: pending.todayHasEntry,
  });
}

async function onPhoto(env: FlowEnv, pending: PendingPonto): Promise<void> {
  const {
    ctx,
    key,
    msg,
    phoneDigits,
    say,
    sayInteractive,
    settings,
    staff,
    transport,
  } = env;
  clearPendingPonto(key);
  const ref = msg.imageRef;
  const photo = ref ? await fetchPhotoForEntry(ref, env.opts) : null;
  let photoId: string | null = null;
  if (photo) {
    const saved = await savePontoPhotoFile(
      ctx.prisma,
      pending.userId,
      photo.buffer,
      photo.mimetype
    ).catch(() => null);
    photoId = saved?.id ?? null;
  }
  // hasPhoto = a foto foi validada e gravada — sem ficheiro não há
  // prova (a Cloud avalia com hasPhoto=false → POR_VALIDAR quando a
  // foto é obrigatória, nunca APROVADO com prova fantasma).
  await finalizePonto(ctx, say, sayInteractive, settings, staff, transport, {
    at: new Date(pending.locationAt ?? pending.commandAt),
    code: pending.command === "ENTRADA" ? pending.code : undefined,
    command: pending.command,
    hasPhoto: photoId !== null,
    location: pending.location,
    // A frescura mede-se sobre a ÚLTIMA interação do fluxo, não sobre o
    // comando: comando+localização+foto são janelas da app (3+5 min) e
    // somadas ao commandAt ultrapassavam o corte de 5 min da Cloud mesmo
    // com o funcionário a responder sempre a tempo — uma entrada
    // aprovável caía em POR_VALIDAR. A cadeia interativa prova por si
    // que o fluxo correu em tempo real; o atraso de transporte real
    // (fila, PC desligado) continua medido desde o envio da foto.
    // Sem código QR em jogo (a foto só existe no fluxo de externos,
    // que não usam QR) nada precisa da hora do comando. Mesmo padrão
    // do finalizeExpiredPhoto.
    messageAt: msg.sentAt ?? msg.createdAt,
    pauseMinutes: pauseMinutesOf(
      pending.pauseSinceAt,
      new Date(pending.locationAt ?? pending.commandAt)
    ),
    phoneDigits,
    photoId,
    todayHasEntry: pending.todayHasEntry,
  });
}

/**
 * Evaluate na Cloud → grava TimeEntry (+liga foto) → confirmação com os
 * botões do passo seguinte. RECUSADO não regista; falha de rede/Cloud
 * também não — o funcionário tenta de novo.
 */
/** Presumida aberta que esta SAIDA fecha — null quando não há ou
 *  quando entretanto houve reentrada: a presumida pertence ao turno
 *  que ficou por fechar e uma entrada depois dela abriu turno novo;
 *  esta SAIDA fecha o turno NOVO e a presumida do anterior continua
 *  por validar em vez de ser substituída (o apuramento separa os
 *  dois turnos). */
async function presumedCorrectionFor(
  ctx: BotReplyCtx,
  staff: PontoStaffMatch,
  settings: Settings
): Promise<string | null> {
  const presumed = await findOpenPresumedExit(
    ctx.prisma,
    staff.user.id,
    tzOf(settings)
  ).catch(() => null);
  if (!presumed) {
    return null;
  }
  // Uma reentrada recusada pela gerência não abre turno nenhum —
  // sem o filtro ela impedia a SAIDA de corrigir a presumida e o
  // apuramento ignorava a saída real do turno anterior.
  const reentry = await ctx.prisma.timeEntry
    .findFirst({
      select: { id: true },
      where: {
        at: { gt: presumed.at },
        corrections: { none: {} },
        type: "ENTRADA",
        userId: staff.user.id,
        validations: { none: { decision: "RECUSADO" } },
      },
    })
    .catch(() => null);
  return reentry ? null : presumed.id;
}

async function finalizePonto(
  ctx: BotReplyCtx,
  say: Say,
  sayInteractive: SayInteractive,
  settings: Settings,
  staff: PontoStaffMatch,
  transport: NonNullable<InboundTransport["ponto"]>["transport"],
  args: FinalizeArgs
): Promise<void> {
  const geoLat = settings.pontoGeoLat;
  const geoLng = settings.pontoGeoLng;
  if (
    geoLat === null ||
    geoLat === undefined ||
    geoLng === null ||
    geoLng === undefined
  ) {
    ctx.log.warn("ponto: shopGeo por configurar — registo ignorado");
    await say(PONTO_TEXT.configMissing);
    return;
  }

  const result = await evaluatePontoMark(ctx.prisma, ctx.log, {
    type: args.command,
    transport,
    ...(args.command === "ENTRADA" && args.code ? { code: args.code } : {}),
    phone: args.phoneDigits,
    messageAt: args.messageAt,
    ...(args.location ? { location: args.location } : {}),
    hasPhoto: args.hasPhoto,
    photoRequired: settings.pontoExternalPhotoRequired,
    shopGeo: {
      lat: geoLat,
      lng: geoLng,
      radiusM: settings.pontoRadiusM,
    },
    user: {
      externalWork: staff.user.externalWork,
      smsAllowed: staff.user.pontoSmsAllowed,
    },
    externalAutoApprove: settings.pontoExternalAutoApprove,
    todayHasEntry: args.todayHasEntry,
  });

  if (!result) {
    await say(PONTO_TEXT.evaluateFailed);
    return;
  }
  if (result.status === "RECUSADO") {
    if (args.photoId) {
      await deletePontoPhoto(ctx.prisma, args.photoId).catch(() => undefined);
    }
    await say(recusadoText(result.reason));
    return;
  }

  // SAIDA normal depois de uma presumida aberta corrige-a: a linha nova
  // aponta correctsId→presumida (a presumida sai dos cálculos por ser
  // superseded) — item 5, fluxo Esquecimentos.
  let correctsId: string | null = null;
  let entryReason = result.reason ?? null;
  if (args.command === "SAIDA") {
    correctsId = await presumedCorrectionFor(ctx, staff, settings);
    if (correctsId) {
      entryReason = "saída registada pelo trabalhador";
    }
  }
  const proofs: Record<string, unknown> = {
    ...result.proofs,
    hasPhoto: args.hasPhoto,
    ...(args.location
      ? {
          accuracy: args.location.accuracy ?? null,
          lat: args.location.lat,
          lng: args.location.lng,
        }
      : {}),
    ...(args.photoId ? { photoId: args.photoId } : {}),
  };
  const entry = await recordPontoEntry(ctx.prisma, {
    at: args.at,
    correctsId,
    proofs,
    reason: entryReason,
    status: result.status,
    transport: TRANSPORT_ENUM[transport],
    type: args.command as TimeEntryType,
    userId: staff.user.id,
  });
  if (args.photoId && entry?.id) {
    await linkPontoPhoto(ctx.prisma, args.photoId, entry.id).catch(
      () => undefined
    );
  }

  const firstName = firstNameOf(staff.user);
  const text = confirmationText(
    args.command,
    args.at,
    tzOf(settings),
    firstName,
    args.pauseMinutes ?? null,
    result.status,
    result.reason
  );
  const buttons = pontoNextButtons(args.command);
  const hint = pontoNextHintText(args.command);
  if (buttons.length > 0) {
    await sayInteractive(
      pontoReplyButtonsInteractive(text, buttons),
      `${text}${hint}`
    );
    return;
  }
  await say(`${text}${hint}`);
}

function tzOf(settings: Settings): string {
  return settings.timezone ?? process.env.TZ ?? "UTC";
}

/** ESTADO (§2.5): horas de hoje e da semana + registos por validar. */
async function replyEstado(
  ctx: BotReplyCtx,
  say: Say,
  userId: string,
  tz: string
): Promise<void> {
  const now = new Date();
  const wStart = weekStart(tz, now);
  const { start: todayStart } = dayRange(tz, now);
  const entries = await pontoEntriesSince(ctx.prisma, userId, wStart);
  const today = entries.filter((e) => e.at >= todayStart);
  // Por validar = ainda sem decisão do painel — o status da linha é o
  // da avaliação automática e não muda com a validação (append-only),
  // por isso um registo já decidido não pode contar outra vez.
  const pendingCount = today.filter(
    (e) => e.status === "POR_VALIDAR" && !(e.validations?.length ?? 0)
  ).length;
  const marks = today
    .map((e) => `${ENTRY_TYPE_PT[e.type] ?? e.type} ${hhmm(e.at, tz)}`)
    .join(" · ");
  const lines = [
    `Hoje: ${fmtHours(workedMs(today, tz))}${marks ? ` — ${marks}` : ""}`,
    `Semana: ${fmtHours(workedMs(entries, tz))}`,
  ];
  if (pendingCount > 0) {
    lines.push(`${pendingCount} por validar.`);
  }
  await say(lines.join("\n"));
}
