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
