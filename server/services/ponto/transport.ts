import ptMessages from "../../../src/i18n/locales/pt.json";

// Textos PT-PT do livro de ponto e construtores dos payloads
// interativos Meta (location_request_message e botões de resposta).
// Os canais sem interativo (Evolution, SMS) recebem o equivalente em
// texto — ver nextStepHintText.

export const PONTO_BUTTON_IDS = {
  entrada: "ponto_entrada",
  pausa: "ponto_pausa",
  saida: "ponto_saida",
  voltei: "ponto_voltei",
} as const;

export type PontoButtonId =
  (typeof PONTO_BUTTON_IDS)[keyof typeof PONTO_BUTTON_IDS];

// Termos apresentados na pergunta de clarificação do dia (ONTEM/HOJE)
// e reconhecidos na resposta — fonte única para o texto enviado (aqui)
// e para o parser da resposta (handler.ts), para que a pergunta e as
// respostas aceites nunca divirjam. Em pt-PT como o resto do protocolo
// do ponto (os próprios comandos são palavras PT).
export const PONTO_EXIT_DATE_TERMS = {
  now: "agora",
  today: "hoje",
  yesterday: "ontem",
} as const;

export const PONTO_TEXT = {
  commands:
    "Comandos do livro de ponto: ENTRADA (leia o QR), PAUSA, VOLTEI, SAIDA, ESTADO, REGISTOS (os seus registos do mês).",
  configMissing: ptMessages["ponto.config_missing"],
  configMissingCompany: ptMessages["ponto.config_missing_company"],
  entradaNeedsCode:
    "Para registar a entrada precisa do código do QR — aponte a câmara para o QR do livro de ponto.",
  evaluateFailed:
    "Não consegui validar o registo agora — tente outra vez dentro de momentos.",
  locationExpired:
    "O pedido de localização expirou — escreva o comando outra vez.",
  locationPromptInteractive:
    "Partilhe a sua localização para registar o ponto.",
  locationPromptText:
    "Para registar o ponto, partilhe a sua localização: toque em 📎 → Localização → localização atual.",
  noEntryToday: "Não tem entrada registada hoje — leia o QR para começar.",
  noPendingLocation:
    "Não tenho nenhum pedido de localização pendente — escreva ENTRADA, PAUSA, VOLTEI, SAIDA ou ESTADO.",
  noPendingPhoto:
    "Não tenho nenhum pedido de foto pendente — escreva ENTRADA, PAUSA, VOLTEI, SAIDA ou ESTADO.",
  photoPrompt: "Envie uma foto do local de trabalho como prova do registo.",
  smsNotAllowed: "O registo por SMS não está ativado — use o WhatsApp.",
  // Lembrete de saída (item 5) — a resposta ambígua repete a pergunta;
  // o pending de saída continua vivo até resposta clara ou TTL (~2 h).
  exitReminderReprompt:
    "Responda SIM se saiu à hora indicada ou escreva a hora de saída (ex.: 18:05).",
  // Presumida recusada pela gerência — o trabalhador não a substitui
  // por WhatsApp; o acerto faz-se no painel com o gestor.
  exitReminderRejected:
    "A saída presumida foi recusada pela gerência — fale com o responsável para acertar o ponto.",
  // Hora declarada ambígua entre dois dias (resposta depois da
  // meia-noite): pergunta-se o dia antes de gravar — nunca se assume.
  exitDateClarifyReprompt: `Responda ${PONTO_EXIT_DATE_TERMS.yesterday.toUpperCase()} ou ${PONTO_EXIT_DATE_TERMS.today.toUpperCase()}.`,
  // Lembrete de pausa (§2.2b) — nunca fecha a pausa sozinho.
  pauseReminder:
    "OficinaOS: ainda está em pausa? Quando regressar, responda VOLTEI.",
} as const;

export function pontoConfigMissingText(shopMode?: string | null): string {
  return shopMode === "ponto_only"
    ? PONTO_TEXT.configMissingCompany
    : PONTO_TEXT.configMissing;
}

/** Texto livre do lembrete de saída — o mesmo corpo do template Meta
 *  `ponto_lembrete` ({{exitTime}} ← pontoExitReminderTime). */
export function pontoExitReminderText(exitTime: string): string {
  return `OficinaOS: ainda não tem saída registada. Saiu às ${exitTime}? Responda SIM ou indique a hora.`;
}

/** Pergunta de clarificação quando a hora declarada pode pertencer a
 *  dois dias civis (resposta depois da meia-noite): `ymdReminder` é o
 *  dia do lembrete (= ONTEM), `ymdReply` o dia da resposta (= HOJE). */
export function pontoExitDateQuestion(
  hhmm: string,
  ymdReminder: string,
  ymdReply: string
): string {
  const ddmm = (ymd: string) => {
    const [, m, d] = ymd.split("-");
    return `${d}/${m}`;
  };
  const ontem = PONTO_EXIT_DATE_TERMS.yesterday.toUpperCase();
  const hoje = PONTO_EXIT_DATE_TERMS.today.toUpperCase();
  return `${hhmm} — dia ${ddmm(ymdReminder)} ou dia ${ddmm(ymdReply)}? Responda ${ontem} ou ${hoje}.`;
}

/** Nome do template Meta utility do lembrete de saída — sincronizado
 *  automaticamente para a WABA da loja (whatsapp-templates.service). */
export const PONTO_LEMBRETE_TEMPLATE = "ponto_lembrete";

/** Pedido interativo de localização (Meta Cloud API / Graph). */
export function pontoLocationRequestInteractive(
  bodyText: string
): Record<string, unknown> {
  return {
    action: { name: "send_location" },
    body: { text: bodyText },
    type: "location_request_message",
  };
}

export interface PontoReplyButton {
  id: PontoButtonId;
  title: string;
}

/** Botões de resposta rápida após uma marcação (máx. 3 — Meta). */
export function pontoReplyButtonsInteractive(
  bodyText: string,
  buttons: PontoReplyButton[]
): Record<string, unknown> {
  return {
    action: {
      buttons: buttons.map((b) => ({
        reply: { id: b.id, title: b.title },
        type: "reply",
      })),
    },
    body: { text: bodyText },
    type: "button",
  };
}

/** Botões do passo seguinte por comando — só faz sentido no canal
 *  oficial (interactive); Evolution/SMS recebem o hint em texto. */
export function pontoNextButtons(command: string): PontoReplyButton[] {
  if (command === "ENTRADA" || command === "VOLTEI") {
    return [
      { id: PONTO_BUTTON_IDS.pausa, title: "Pausa" },
      { id: PONTO_BUTTON_IDS.saida, title: "Saída" },
    ];
  }
  if (command === "PAUSA") {
    return [{ id: PONTO_BUTTON_IDS.voltei, title: "Voltei" }];
  }
  return [];
}

/** Sufixo em texto para canais sem interativo. */
export function pontoNextHintText(command: string): string {
  if (command === "ENTRADA" || command === "VOLTEI") {
    return " Responda PAUSA ou SAIDA.";
  }
  if (command === "PAUSA") {
    return " Responda VOLTEI quando regressar.";
  }
  return "";
}
