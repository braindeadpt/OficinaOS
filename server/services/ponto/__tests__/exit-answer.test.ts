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
  it("«Saí às 18. 20 minutos antes de fecharem» → 18:00 (não 18:20)", () => {
    // O "." fecha a frase quando um espaço o separa dos dígitos que
    // quantificam uma duração — «18» e «20 minutos» ficam em orações
    // separadas e a quantidade de duração não é hora candidata: fica
    // só a hora solta da primeira oração.
    expect(
      parsePontoExitAnswer("Saí às 18. 20 minutos antes de fecharem")
    ).toEqual({ hhmm: "18:00", kind: "time" });
  });

  it("«Saí às 18.30 horas» → 18:30 — HH.MM compacto ganha ao sufixo", () => {
    // Sem espaço depois do ponto é sempre Horas.minutos — mesmo antes
    // de «horas»/«minutos» («18.30 horas» não é frase + duração).
    expect(parsePontoExitAnswer("Saí às 18.30 horas")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí às 18.05 horas")).toEqual({
      hhmm: "18:05",
      kind: "time",
    });
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

  it("«Não saí às 18. 15 minutos depois» → null — a duração não é hora", () => {
    // A primeira oração nega-se; a segunda só tem a quantidade de uma
    // duração — «15» não pode virar a única hora candidata (registava
    // 15:00 por engano). Sem hora nenhuma, repete-se a pergunta.
    expect(parsePontoExitAnswer("Não saí às 18. 15 minutos depois")).toBeNull();
    expect(parsePontoExitAnswer("saí há 20 minutos")).toBeNull();
  });
});

describe("parsePontoExitAnswer — horas por extenso e durações", () => {
  it("«saí às 18 horas e 15 minutos» → 18:15 — o «e» liga os minutos", () => {
    expect(parsePontoExitAnswer("saí às 18 horas e 15 minutos")).toEqual({
      hhmm: "18:15",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí às 6 horas e 30")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    // Sem «e», «18 horas» continua hora solta = 18:00.
    expect(parsePontoExitAnswer("saí às 18 horas")).toEqual({
      hhmm: "18:00",
      kind: "time",
    });
  });

  it("«saí há 2 horas e 15 minutos» → null — duração não é hora", () => {
    // «há/faz» + quantidade é duração relativa: a frase sai toda —
    // «2 horas e 15 minutos» não é o relógio «2:15» e o «2» solto não
    // pode virar 14:00. Sem hora lida com segurança, repete-se.
    expect(parsePontoExitAnswer("saí há 2 horas e 15 minutos")).toBeNull();
    expect(parsePontoExitAnswer("saí há 2 horas")).toBeNull();
    expect(parsePontoExitAnswer("saí faz 1 hora e 30 minutos")).toBeNull();
  });

  it("«às 6 horas e meia» → 18:30", () => {
    expect(parsePontoExitAnswer("saí às 6 horas e meia")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
  });

  it("«trabalhei 8 horas e 30 minutos» → null — sem «às» não é hora", () => {
    // Duração composta sem «há/faz» nem «às»: nem a hora por extenso
    // (20:30) nem a parte das «horas» solta (20:00) podem gravar-se.
    expect(parsePontoExitAnswer("trabalhei 8 horas e 30 minutos")).toBeNull();
    expect(parsePontoExitAnswer("fiquei 2 horas e meia")).toBeNull();
  });
});
