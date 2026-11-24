// Mapeamento do payload da fila oficial (Cloud GET /whatsapp/inbound)
// para os campos do livro de ponto. A Cloud guarda `payload` na row
// WhatsAppInbound (location coords, button_reply/list_reply) — o poll
// devolve-o quando presente; o `text` já chega com o id do botão
// ("ponto_pausa") ou o título, por isso o parser apanha comandos de
// botão mesmo sem payload.

import type { InboundMessage } from "../bot-intents.js";

interface CloudInboundRow {
  messageType?: string | null;
  payload?: unknown;
  text?: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function locationFields(
  payload: Record<string, unknown> | null
): Pick<InboundMessage, "location"> {
  const lat = payload?.latitude;
  const lng = payload?.longitude;
  return typeof lat === "number" && typeof lng === "number"
    ? { location: { lat, lng } }
    : {};
}

function interactiveFields(
  row: CloudInboundRow,
  payload: Record<string, unknown> | null
): Pick<InboundMessage, "interactiveId"> {
  if (!payload) {
    return {};
  }
  const buttonReply = asRecord(payload.button_reply);
  const listReply = asRecord(payload.list_reply);
  const id =
    (typeof buttonReply?.id === "string" ? buttonReply.id : undefined) ??
    (typeof listReply?.id === "string" ? listReply.id : undefined) ??
    // Sem payload estruturado: o text já é o id (ou o título) do botão.
    (typeof row.text === "string" ? row.text : undefined);
  return id ? { interactiveId: id } : {};
}

function quotedFields(
  payload: Record<string, unknown> | null
): Pick<InboundMessage, "quotedMessageId"> {
  // Resposta citada (reply): a Meta envia context.id = wamid da
  // mensagem citada — a Cloud só o reencaminha se o guardar na row.
  const ctx = asRecord(payload?.context);
  return typeof ctx?.id === "string" ? { quotedMessageId: ctx.id } : {};
}

function imageFields(
  payload: Record<string, unknown> | null
): Pick<InboundMessage, "imageRef"> {
  // Imagem oficial: a Meta não retransmite a média na fila — se um dia
  // o payload a trouxer, a app já sabe o que fazer com ela.
  if (!payload) {
    return {};
  }
  return {
    imageRef: {
      mimetype:
        typeof payload.mime_type === "string" ? payload.mime_type : null,
      url: typeof payload.url === "string" ? payload.url : null,
    },
  };
}

/**
 * Extrai location/imageRef/interactiveId/quotedMessageId de uma row da
 * fila oficial. Campos ausentes (payload ainda não exposto pelo poll,
 * ou tipo de mensagem sem equivalente) devolvem-se undefined — o
 * handler decide.
 */
export function pontoFieldsFromCloudRow(
  row: CloudInboundRow
): Pick<
  InboundMessage,
  "imageRef" | "interactiveId" | "location" | "quotedMessageId"
> {
  const payload = asRecord(row.payload);
  const isLocation = row.messageType === "location";
  const isInteractive = row.messageType === "interactive";
  const isImage = row.messageType === "image" || row.messageType === "photo";
  return {
    ...(isLocation ? locationFields(payload) : {}),
    ...(isInteractive ? interactiveFields(row, payload) : {}),
    ...(isImage ? imageFields(payload) : {}),
    ...quotedFields(payload),
  };
}
