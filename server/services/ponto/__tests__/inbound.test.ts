import { describe, expect, it } from "vitest";

// Correlação reply-quote via relay Cloud: a Meta met o wamid da
// mensagem citada em payload.context.id; a fila inbound tem de o
// retransmitir intacto para quotedMessageId — senão nenhuma resposta
// citada é verificável.

import { pontoFieldsFromCloudRow } from "../inbound.js";

describe("pontoFieldsFromCloudRow — quotedMessageId", () => {
  it("relay cloud: payload.context.id → quotedMessageId", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "text",
      payload: { context: { id: "wamid.pergunta.123" } },
      text: "SIM",
    } as never);

    expect(out.quotedMessageId).toBe("wamid.pergunta.123");
  });

  it("sem context no payload → quotedMessageId ausente", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "text",
      payload: {},
      text: "SIM",
    } as never);

    expect(out.quotedMessageId).toBeUndefined();
  });

  it("payload ausente → quotedMessageId ausente", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "text",
      payload: null,
      text: "SIM",
    } as never);

    expect(out.quotedMessageId).toBeUndefined();
  });

  it("context.id não string → ignorado", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "text",
      payload: { context: { id: 42 } },
      text: "SIM",
    } as never);

    expect(out.quotedMessageId).toBeUndefined();
  });
});

describe("pontoFieldsFromCloudRow — imageRef (prova fotográfica)", () => {
  // Formato real confirmado na Cloud (oficinaos-cloud whatsapp.ts): o
  // webhook só constrói payload para location/interactive — uma imagem
  // chega SEMPRE com payload null. A prova é o próprio messageType.
  it("imagem SEM payload regista imageRef — é o formato real do relay", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "image",
      payload: null,
      text: null,
    } as never);

    expect(out.imageRef).toEqual({ mimetype: null });
  });

  it("imagem com payload vazio também regista imageRef", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "image",
      payload: {},
      text: null,
    } as never);

    expect(out.imageRef).toEqual({ mimetype: null });
  });

  it("messageType photo (variante) regista imageRef", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "photo",
      payload: null,
      text: null,
    } as never);

    expect(out.imageRef).toEqual({ mimetype: null });
  });

  it("texto não gera imageRef", () => {
    const out = pontoFieldsFromCloudRow({
      messageType: "text",
      payload: null,
      text: "ponto",
    } as never);

    expect(out.imageRef).toBeUndefined();
  });
});
