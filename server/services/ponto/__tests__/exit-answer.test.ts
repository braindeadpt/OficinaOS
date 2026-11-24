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
    expect(parsePontoExitAnswer("saí às 18:05 ou às 19:10")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("entre as 18 e as 19")).toEqual({
      kind: "ambiguous",
    });
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

  it("«à» e «pelas» também marcam hora por extenso", () => {
    expect(parsePontoExitAnswer("Saí à 1 hora e 15 minutos da tarde")).toEqual({
      hhmm: "13:15",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí pelas 18 horas e 15 minutos")).toEqual({
      hhmm: "18:15",
      kind: "time",
    });
    // O «a» conector (sem acento) não é marcador — a duração composta
    // sai inteira e a pergunta repete-se em vez de gravar 13:15.
    expect(parsePontoExitAnswer("sai a 1 hora e 15 minutos")).toBeNull();
  });

  it("«da manhã»/«da noite» sobrepõe-se à heurística da tarde", () => {
    expect(
      parsePontoExitAnswer("Saí pelas 8 horas e 15 minutos da noite")
    ).toEqual({ hhmm: "20:15", kind: "time" });
    expect(parsePontoExitAnswer("Saí à 1 hora e 15 minutos da manhã")).toEqual({
      hhmm: "01:15",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí pelas 8 horas da noite")).toEqual({
      hhmm: "20:00",
      kind: "time",
    });
    // Qualificador impossível — ambíguo, repete-se a pergunta.
    expect(parsePontoExitAnswer("saí às 18 horas da manhã")).toBeNull();
  });

  it("«a» conector de intervalo não é marcador de hora", () => {
    // «de 1 a 2 horas e meia» é um intervalo de duração, não «à 2
    // horas e 30 minutos» — sem hora lida com segurança, repete-se.
    expect(
      parsePontoExitAnswer(
        "Fiquei 1 hora e meia a 2 horas e 30 minutos à espera"
      )
    ).toBeNull();
    // O intervalo também não pode fazer uma hora válida parecer ambígua.
    expect(
      parsePontoExitAnswer("Saí às 18:05 após um turno de 7 a 8 horas e meia")
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("«às 18 horas e 1 hora depois» → null — a 2.ª unidade é duração", () => {
    // O número a seguir a «horas e» não pode virar minutos quando é
    // ele próprio uma quantidade de duração («1 hora depois»,
    // «1 hora atrás») — a leitura fica ambígua e a pergunta repete-se
    // (nunca 18:01).
    expect(
      parsePontoExitAnswer("saí às 18 horas e 1 hora depois cheguei a casa")
    ).toBeNull();
    // O guarda vale também para os minutos com unidade: «15 minutos
    // depois» pode descrever outra ação — ambíguo, repete-se.
    expect(
      parsePontoExitAnswer(
        "Saí pelas 18 horas e 15 minutos depois cheguei a casa"
      )
    ).toBeNull();
    expect(parsePontoExitAnswer("saí às 18 horas e 1 hora atrás")).toBeNull();
    expect(
      parsePontoExitAnswer("saí às 18:05 horas e 15 minutos depois")
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("intervalo/alternativa com hora lida → ambíguo, repete-se", () => {
    // «entre as 7 e as 8 horas da noite» não escolhe a última: o «7»
    // que fica fora da leitura «8 da noite» é outra hora candidata.
    expect(
      parsePontoExitAnswer("Saí entre as 7 e as 8 horas da noite")
    ).toEqual({ kind: "ambiguous" });
    expect(parsePontoExitAnswer("saí às 8 horas da noite ou às 21")).toEqual({
      kind: "ambiguous",
    });
    // «N a N» é intervalo de duração, não alternativa de horas — a
    // hora compacta mantém-se única.
    expect(
      parsePontoExitAnswer("Saí às 18:05 após um turno de 7 a 8 horas")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // «dia 5» é data, não a hora 17:00.
    expect(parsePontoExitAnswer("saí pelas 8 horas da noite no dia 5")).toEqual(
      { hhmm: "20:00", kind: "time" }
    );
  });

  it("«00 horas … da noite» é meia-noite, não meio-dia", () => {
    // «00» já vem em formato 24 h — o período não lhe soma 12.
    expect(
      parsePontoExitAnswer("Saí às 00 horas e 15 minutos da noite")
    ).toEqual({ hhmm: "00:15", kind: "time" });
    expect(parsePontoExitAnswer("saí pelas 12 horas da noite")).toEqual({
      hhmm: "00:00",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí pelas 8 horas da noite")).toEqual({
      hhmm: "20:00",
      kind: "time",
    });
  });

  it("«mais ou menos» não corta a hora por extenso", () => {
    expect(
      parsePontoExitAnswer("Saí pelas 18 horas e 15 minutos mais ou menos")
    ).toEqual({ hhmm: "18:15", kind: "time" });
    // «mais tarde» continua a ser continuação temporal — ambíguo.
    expect(
      parsePontoExitAnswer("Saí pelas 18 horas e 15 minutos mais tarde")
    ).toBeNull();
    // «mais cedo» também — os «15 minutos» podem ser duração.
    expect(
      parsePontoExitAnswer(
        "Saí pelas 18 horas e 15 minutos mais cedo do que o habitual"
      )
    ).toBeNull();
    // E sem unidade nos minutos.
    expect(parsePontoExitAnswer("saí às 18 horas e 15 mais cedo")).toBeNull();
  });

  it("«depois de trabalhar 8 horas» não é segunda hora de saída", () => {
    // A quantidade mede o turno — a hora única é a compacta.
    expect(
      parsePontoExitAnswer("Saí às 18:05 depois de trabalhar 8 horas")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer("Saí às 18:05 e trabalhei mais de 2 horas")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // Sem verbo de duração, «às 19 horas» é alternativa — ambíguo.
    expect(parsePontoExitAnswer("saí às 18:05 ou às 19 horas")).toEqual({
      kind: "ambiguous",
    });
  });

  it("«à» marcador serve nas duas codificações Unicode", () => {
    // NFC: «à» num só carácter; NFD: «a» + acento combinante.
    expect(parsePontoExitAnswer("Saí à 1 hora e 15 minutos da tarde")).toEqual({
      hhmm: "13:15",
      kind: "time",
    });
    expect(parsePontoExitAnswer("Saí à 1 hora e 15 minutos da tarde")).toEqual({
      hhmm: "13:15",
      kind: "time",
    });
  });

  it("data antes da hora não esconde o marcador nem vira hora", () => {
    // «dia 17 às …» — o «às» a seguir ao número do dia continua a
    // marcar e «dia 17» não é a hora 17:00.
    expect(parsePontoExitAnswer("Saí dia 17 às 6 horas e meia")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    expect(parsePontoExitAnswer("Saí dia 24 às 8 horas da noite")).toEqual({
      hhmm: "20:00",
      kind: "time",
    });
    // «23/11» — data com barras sai do texto; fica só a hora.
    expect(parsePontoExitAnswer("Saí 23/11 18:05")).toEqual({
      hhmm: "18:05",
      kind: "time",
    });
    // Intervalo abreviado — duas horas candidatas: ambíguo.
    expect(parsePontoExitAnswer("Saí 18:05-19")).toEqual({
      kind: "ambiguous",
    });
  });

  it("«mais cedo» é continuação temporal como «mais tarde»", () => {
    // «15 minutos mais cedo do que o habitual» pode ser duração —
    // ambíguo sem candidatos, repete-se a pergunta (nunca 18:15).
    expect(
      parsePontoExitAnswer(
        "Saí pelas 18 horas e 15 minutos mais cedo do que o habitual"
      )
    ).toBeNull();
    // A exceção mantém-se: «mais ou menos» grava 18:15.
    expect(
      parsePontoExitAnswer("Saí pelas 18 horas e 15 minutos mais ou menos")
    ).toEqual({ hhmm: "18:15", kind: "time" });
  });

  it("duração do turno não é segunda hora de saída", () => {
    // «depois de trabalhar 8 horas» — o verbo marca duração; a hora
    // única grava-se.
    expect(
      parsePontoExitAnswer("Saí às 18:05 depois de trabalhar 8 horas")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer("saí às 18:30, fiquei 8 horas de serviço")
    ).toEqual({ hhmm: "18:30", kind: "time" });
    // …mas «N horas» sem contexto de duração continua candidato:
    // «às 18:05 ou às 19 horas» fica ambíguo.
    expect(parsePontoExitAnswer("Saí às 18:05 ou às 19 horas")).toEqual({
      kind: "ambiguous",
    });
  });
});
