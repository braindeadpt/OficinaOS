import { describe, expect, it } from "vitest";

// Parser das respostas ao lembrete de saída (item 5): SIM/hora
// declarada/negações. A negação vale por oração — "não saí às 18:00"
// não declara saída, mas "Não, saí às 18:20" declara.

import { parsePontoExitAnswer } from "../exit-answer.js";

describe("parsePontoExitAnswer — confirmação", () => {
  it('"SIM" → confirmed', () => {
    expect(parsePontoExitAnswer("SIM")).toEqual({ kind: "confirmed" });
    expect(parsePontoExitAnswer("sim, obrigado")).toBeNull();
    expect(parsePontoExitAnswer("certo")).toEqual({ kind: "confirmed" });
  });
});

describe("parsePontoExitAnswer — hora declarada", () => {
  it('hora explícita "18:05" / "18h05" / "6:30"', () => {
    expect(parsePontoExitAnswer("saí às 18:05")).toEqual({
      hhmm: "18:05",
      kind: "time",
    });
    expect(parsePontoExitAnswer("18h30")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    // 6–7 de tarde assumem-se (a saída é à noite).
    expect(parsePontoExitAnswer("saí às 6:30")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí às 6")).toEqual({
      hhmm: "18:00",
      kind: "time",
    });
  });

  it("hora solta única → +12 quando 1–7", () => {
    expect(parsePontoExitAnswer("7")).toEqual({ hhmm: "19:00", kind: "time" });
    expect(parsePontoExitAnswer("18")).toEqual({
      hhmm: "18:00",
      kind: "time",
    });
  });
});

describe("parsePontoExitAnswer — negações por oração", () => {
  it('"Não saí, ainda estou a trabalhar" → null (não declara saída)', () => {
    expect(parsePontoExitAnswer("Não saí, ainda estou a trabalhar")).toBeNull();
    expect(parsePontoExitAnswer("não saí às 18:00")).toBeNull();
    expect(parsePontoExitAnswer("ainda não saí")).toBeNull();
  });

  it('"Não, saí às 18:20" → time (negação na oração anterior)', () => {
    expect(parsePontoExitAnswer("Não, saí às 18:20")).toEqual({
      hhmm: "18:20",
      kind: "time",
    });
  });
});

describe("parsePontoExitAnswer — ambíguo", () => {
  it("duas horas distintas → null (repete a pergunta)", () => {
    expect(parsePontoExitAnswer("saí às 18:05 ou às 19:10")).toBeNull();
    expect(parsePontoExitAnswer("entre as 18 e as 19")).toBeNull();
  });

  it("texto irreconhecível → null", () => {
    expect(parsePontoExitAnswer("não sei")).toBeNull();
    expect(parsePontoExitAnswer("")).toBeNull();
    expect(parsePontoExitAnswer(null)).toBeNull();
  });
});

describe("parsePontoExitAnswer — ponto antes de duração", () => {
  it("«Saí às 18. 20 minutos antes de fecharem» → null (não 18:20)", () => {
    // O "." fecha a frase quando os dígitos a seguir quantificam uma
    // duração — «18» e «20 minutos» ficam em orações separadas, duas
    // horas candidatas é ambíguo e a resposta pede-se de novo em vez
    // de gravar 18:20 por engano.
    expect(
      parsePontoExitAnswer("Saí às 18. 20 minutos antes de fecharem")
    ).toBeNull();
  });

  it("«Saí às 18. 30» continua a ler 18:30", () => {
    expect(parsePontoExitAnswer("Saí às 18. 30")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí às 18. 30 da noite")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
  });
});
