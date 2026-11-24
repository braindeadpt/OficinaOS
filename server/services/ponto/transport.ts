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

export const PONTO_TEXT = {
  commands:
    "Comandos do livro de ponto: ENTRADA (leia o QR), PAUSA, VOLTEI, SAIDA, ESTADO.",
  configMissing:
    "A loja ainda não configurou a localização do livro de ponto — avise o responsável.",
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
} as const;

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
