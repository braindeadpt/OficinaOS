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
    // «23/11» — data com barras sai do texto e fica declarada na
    // resposta: o handler só grava se coincidir com o dia do turno.
    expect(parsePontoExitAnswer("Saí 23/11 18:05")).toEqual({
      date: { day: 23, month: 11, year: null },
      hhmm: "18:05",
      kind: "time",
    });
    // Intervalo abreviado — duas horas candidatas: ambíguo. A ponta
    // com hífen não é data («00-19» colada a «:» fica no texto e o
    // «18-19» de «18-19:30» também).
    expect(parsePontoExitAnswer("Saí 18:05-19")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("Saí 18:00-19")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("Saí 18-19:30")).toEqual({
      kind: "ambiguous",
    });
    // Duas datas distintas declaradas — ambíguo como duas horas.
    expect(parsePontoExitAnswer("Saí 23/11 ou 24/11 às 18:05")).toEqual({
      kind: "ambiguous",
    });
    // ISO «2026-01-10» lê-se inteira — o sufixo «01-10» não vira
    // 1 de outubro.
    expect(parsePontoExitAnswer("Saí às 18:05 em 2026-01-10")).toEqual({
      date: { day: 10, month: 1, year: 2026 },
      hhmm: "18:05",
      kind: "time",
    });
    // Dois-pontos a introduzir texto não escondem a data — «10/1:
    // saí …» declara a data e a hora («18-19:30» continua ambíguo:
    // aí os dois-pontos formam uma hora).
    expect(parsePontoExitAnswer("10/1: saí às 18:05")).toEqual({
      date: { day: 10, month: 1, year: null },
      hhmm: "18:05",
      kind: "time",
    });
  });

  it("data negada não conta — a afirmada qualifica a saída", () => {
    // «Não foi a 9/1, saí a 10/1 às 18:05» — a mesma regra das
    // horas por oração: a negação só descarta a própria oração.
    expect(parsePontoExitAnswer("Não foi a 9/1, saí a 10/1 às 18:05")).toEqual({
      date: { day: 10, month: 1, year: null },
      hhmm: "18:05",
      kind: "time",
    });
    // O til separado («a» + U+0303) lê-se igual — a posição da
    // negação mede-se no texto NFC tal como os índices das datas.
    expect(
      parsePontoExitAnswer(
        "Não foi a 9/1, saí a 10/1 às 18:05".normalize("NFD")
      )
    ).toEqual({
      date: { day: 10, month: 1, year: null },
      hhmm: "18:05",
      kind: "time",
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
    // «depois das 19 horas» é um limite de hora, não duração — a
    // alternativa fica e a resposta é ambígua.
    expect(parsePontoExitAnswer("Saí às 18:05 ou depois das 19 horas")).toEqual(
      { kind: "ambiguous" }
    );
    expect(parsePontoExitAnswer("Saí às 18:05 ou antes das 19 horas")).toEqual({
      kind: "ambiguous",
    });
    // «trabalhar 8 horas e 15» é uma duração só — não sobra um «15»
    // para ler como hora.
    expect(
      parsePontoExitAnswer("Saí depois de trabalhar 8 horas e 15")
    ).toBeNull();
    expect(
      parsePontoExitAnswer("Saí às 18:05 depois de trabalhar 8 horas e 15")
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("limite «depois das»/«antes das» sozinho não é hora exata", () => {
    // «Saí depois das 19 horas» diz que saiu DEPOIS — não às 19:00.
    expect(parsePontoExitAnswer("Saí depois das 19 horas")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("saí antes das 8 horas")).toEqual({
      kind: "ambiguous",
    });
    // Noutra oração o limite é contexto (o fim previsto do turno),
    // não uma alternativa — a hora única grava-se.
    expect(
      parsePontoExitAnswer("Saí às 18:05. O meu turno era até às 18 horas.")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // …mas ligado por «ou» continua alternativa, mesmo depois de
    // pontuação — duas possibilidades em aberto, repete-se.
    expect(
      parsePontoExitAnswer("Saí às 18:05, ou talvez depois das 19 horas")
    ).toEqual({ kind: "ambiguous" });
    // Repetir a hora noutra oração não apaga o conflito — a
    // presença de hora conta na própria oração, não no conjunto.
    expect(
      parsePontoExitAnswer(
        "Acho que foi às 18. Talvez às 18 ou depois das 19 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    // …mas repetir a hora a explicar o horário da loja é contexto —
    // sem «ou» a ligar o limite, a hora única grava-se.
    expect(
      parsePontoExitAnswer(
        "Saí às 18. Às 18 a loja ainda estava aberta e ficava aberta até às 19 horas."
      )
    ).toEqual({ hhmm: "18:00", kind: "time" });
    // «ou seja» explica, não alterna — o limite é contexto.
    expect(
      parsePontoExitAnswer("Saí às 18:05, ou seja antes das 19 horas")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // …mas uma reformulação que contradiz a hora declarada
    // («ou seja depois das 19» para 18:05) fica ambígua.
    expect(
      parsePontoExitAnswer("Saí às 18:05, ou seja depois das 19 horas")
    ).toEqual({ kind: "ambiguous" });
    // O limite interpreta-se como a hora declarada — «depois das 7»
    // é depois das 19:00 e contradiz «às 6» (18:00); com zero
    // inicial («07») fica em 24 h e a reformulação é coerente.
    expect(
      parsePontoExitAnswer("Saí às 6, ou seja depois das 7 horas")
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer("Saí às 6, ou seja depois das 07 horas")
    ).toEqual({ hhmm: "18:00", kind: "time" });
    expect(parsePontoExitAnswer("Saí às 6, ou seja antes das 7 horas")).toEqual(
      { hhmm: "18:00", kind: "time" }
    );
    // Advérbios entre «ou» e o limite não escondem a alternativa.
    expect(
      parsePontoExitAnswer(
        "Acho que saí às 18. Talvez às 18 ou só depois das 19 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    // «18:00» e «18» declaram a mesma hora — repetida a explicar o
    // horário da loja fica contexto mesmo trocando o formato.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:00. Às 18 a loja ainda estava aberta até às 19 horas"
      )
    ).toEqual({ hhmm: "18:00", kind: "time" });
    expect(
      parsePontoExitAnswer(
        "Acho que saí às 18:05. Talvez às 18:05 ou só depois das 19 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    // «até às 18» é limite inclusivo — reformular a mesma hora aceita.
    expect(
      parsePontoExitAnswer("Saí às 18 horas, ou seja até às 18 horas")
    ).toEqual({ hhmm: "18:00", kind: "time" });
    // A hora solta compara-se já interpretada — «às 6» é 18:00 e
    // «depois das 17» é coerente com ela.
    expect(
      parsePontoExitAnswer("Saí às 6, ou seja depois das 17 horas")
    ).toEqual({ hhmm: "18:00", kind: "time" });
    // «às 7» (19:00) não é «07:00» — a hora da segunda oração é nova
    // e o limite contradiz-la: ambíguo.
    expect(
      parsePontoExitAnswer(
        "Saí às 7. Às 07:00 ainda estava a trabalhar até às 8 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    // Data reconhecida mas inválida — pergunta-se, não se grava a
    // hora no dia errado.
    expect(parsePontoExitAnswer("Saí às 18:05 em 2026-13-10")).toEqual({
      kind: "ambiguous",
    });
    // A negação depois da data tem âmbito incerto — pergunta-se em
    // vez de tratar a resposta como sem data.
    expect(
      parsePontoExitAnswer("A 09/01 não sei a hora ao certo, mas saí às 18:05")
    ).toEqual({ kind: "ambiguous" });
    // …mas a negação ANTES da data anula-a — fica a data afirmada.
    expect(parsePontoExitAnswer("Não foi a 9/1, saí a 10/1 às 18:05")).toEqual({
      date: { day: 10, month: 1, year: null },
      hhmm: "18:05",
      kind: "time",
    });
    // «ou» continua a oração que o antecede — ligado a um limite de
    // contexto («o turno costuma ser até às 18») continua a falar do
    // horário, não propõe alternativa à saída declarada.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. O meu turno costuma ser até às 18 horas, ou até às 19 horas às sextas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // …mas ligado à hora declarada continua alternativa, mesmo com
    // oração de contexto pelo meio a encadear alternativas.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05, ou depois das 19 horas, ou antes das 17 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    // …e a herança não esconde uma nova reivindicação da saída —
    // «ou saí depois das 19» descreve a saída, não o horário.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. O meu turno era até às 18 horas, ou saí depois das 19 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. O meu turno era até às 18 horas, ou a minha saída foi depois das 19 horas"
      )
    ).toEqual({ kind: "ambiguous" });
    // …mas só formas AFIRMADAS reivindicam — «autorização para
    // sair» é permissão e «saía» é hábito: contexto, grava a hora.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Tinha autorização para sair depois das 17 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer("Saí às 18:05. Saía sempre depois das 19 horas.")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // …e o infinito com auxiliar aspectual volta a ser afirmação:
    // «acabei por sair», «consegui sair», «saiu» — o trabalhador
    // corrige a hora declarada e a resposta ambigúa.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Afinal acabei por sair depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Só consegui sair depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. O meu registo só saiu depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    // Repetir o limite de contexto (já deduplicado) não muda o
    // papel da oração — «ou» a seguir continua o horário.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. O meu turno era até às 18 horas. Continuava a ser até às 18 horas, ou até às 19 horas às sextas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // O limite com período compara-se com a hora certa — «depois
    // das 6 horas da manhã» é depois das 06:00, não das 18:00.
    expect(
      parsePontoExitAnswer("Saí às 06:30, ou seja depois das 6 horas da manhã")
    ).toEqual({ hhmm: "06:30", kind: "time" });
    // «após» com a mesma forma — a hora qualificada do limite não
    // volta a ser lida como hora solta.
    expect(
      parsePontoExitAnswer("Saí às 06:30, ou seja após as 6 horas da manhã")
    ).toEqual({ hhmm: "06:30", kind: "time" });
    expect(
      parsePontoExitAnswer("Saí às 06:30, ou seja após as 8 horas da manhã")
    ).toEqual({ kind: "ambiguous" });
    // Minutos por extenso no limite — «depois das 18 horas e meia»
    // é depois das 18:30, não das 18:00.
    expect(
      parsePontoExitAnswer("Saí às 18:20, ou seja depois das 18 horas e meia")
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer("Saí às 18:45, ou seja depois das 18 horas e meia")
    ).toEqual({ hhmm: "18:45", kind: "time" });
    expect(
      parsePontoExitAnswer("Saí às 18:45, ou seja antes das 18 horas e meia")
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:20, ou seja depois das 18 horas e 30 minutos"
      )
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer("Saí às 06:30, ou seja antes das 6 horas da manhã")
    ).toEqual({ kind: "ambiguous" });
    // Minutos e período no mesmo limite — «depois das 6 horas e
    // meia da manhã» é depois das 06:30, não das 06:00 nem 18:30.
    expect(
      parsePontoExitAnswer(
        "Saí às 06:45, ou seja depois das 6 horas e meia da manhã"
      )
    ).toEqual({ hhmm: "06:45", kind: "time" });
    expect(
      parsePontoExitAnswer(
        "Saí às 06:20, ou seja depois das 6 horas e meia da manhã"
      )
    ).toEqual({ kind: "ambiguous" });
    // A continuação de duração não é minutos do limite — «e meia
    // hora antes de fechar» e «e 30 minutos antes» ficam de fora:
    // o limite é 18:00 e contradiz 18:20.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:20, ou seja antes das 18 horas e meia hora antes de fechar"
      )
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:20, ou seja antes das 18 horas e 30 minutos antes de fechar"
      )
    ).toEqual({ kind: "ambiguous" });
    // A 3.ª pessoa não afirma a saída do trabalhador — o colega ou
    // a encomenda que «saiu depois das 19» são contexto.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. O meu colega só saiu depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A encomenda só saiu depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // …mas com referência a si («a minha saída») afirma — e
    // contradiz a hora declarada.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A minha saída só saiu registada depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    // «saí» com acento é 1.ª pessoa mesmo com companhia — «com o
    // meu colega» é complemento, não outro sujeito.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Afinal saí com o meu colega depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    // …e na 3.ª pessoa do presente («ele sai») continua contexto.
    expect(
      parsePontoExitAnswer("Saí às 18:05. Ele só sai depois das 19 horas.")
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("mede a afirmação de saída no trecho antes do limite, não na oração toda", () => {
    // «saímos» depois do limite explica outro acontecimento — o
    // horário do gerente fica contexto e a hora declarada vale.
    expect(
      parsePontoExitAnswer(
        "Saímos às 18:05. O gerente saiu depois das 19 horas porque lhe deixámos mais trabalho quando saímos."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // …mas «saí» antes do limite continua a reivindicá-lo.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Afinal saí depois das 19 horas porque fiquei a ajudar."
      )
    ).toEqual({ kind: "ambiguous" });
  });

  it("mantém o antecedente de «que saiu» e o possessivo de «saída»", () => {
    // «com o colega que saiu» — o colega é o sujeito da relativa.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Falei com o colega que saiu depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // «a saída da encomenda» — o possessivo é o dono da saída.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A saída da encomenda foi depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A saída do colega foi depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("só «saí»/«saímos» inteiros afirmam — «saída», «saía», «saíram», «saído» não", () => {
    expect(
      parsePontoExitAnswer("Saí às 18:05. Saía sempre depois das 19 horas.")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer("Saí às 18:05. Saíram depois das 19 horas.")
    ).toEqual({ hhmm: "18:05", kind: "time" });
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A encomenda saída depois das 19 horas era urgente."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
    // «saímos» antes do limite afirma.
    expect(
      parsePontoExitAnswer("Saímos depois das 19 horas, as 18:05.")
    ).toEqual({ kind: "ambiguous" });
  });

  it("reconhece o verbo depois do limite quando ligado por «que»", () => {
    // «foi só depois das 19 que saímos» — o limite modifica a
    // saída do trabalhador, não é horário de contexto.
    expect(
      parsePontoExitAnswer(
        "Saímos às 18:05. Afinal foi só depois das 19 horas que saímos."
      )
    ).toEqual({ kind: "ambiguous" });
    expect(
      parsePontoExitAnswer("Saí às 18:05. Foi depois das 19 horas que saí.")
    ).toEqual({ kind: "ambiguous" });
    // …mas «quando saímos» a explicar outro acontecimento continua
    // fora da prova.
    expect(
      parsePontoExitAnswer(
        "Saímos às 18:05. O gerente saiu depois das 19 horas porque lhe deixámos mais trabalho quando saímos."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("o possessivo de «saída» só veta quando o limite rege essa saída", () => {
    // O limite pertence ao «fui embora» do trabalhador — a saída
    // do colega é só a explicação do atraso.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A saída do colega atrasou tudo e só fui embora depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    // …e o limite sobre a saída doutra pessoa continua contexto.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A saída do colega foi depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("a relativa só segura o sujeito quando contém o verbo de saída", () => {
    // «que tem carro» descreve o acompanhante — o limite é da
    // saída na oração principal.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. A saída com o colega que tem carro só foi depois das 19 horas."
      )
    ).toEqual({ kind: "ambiguous" });
    // …e «que saiu» continua a fazer do colega o sujeito.
    expect(
      parsePontoExitAnswer(
        "Saí às 18:05. Falei com o colega que saiu depois das 19 horas."
      )
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("«ou» com hora solta é alternativa mesmo depois de vírgula", () => {
    expect(parsePontoExitAnswer("Saí às 18:05, ou às 19")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("Saí às 18:05 ou às 19")).toEqual({
      kind: "ambiguous",
    });
    // …mas «ou seja» continua reformulação, não alternativa.
    expect(
      parsePontoExitAnswer("Saí às 18:05, ou seja antes das 19 horas")
    ).toEqual({ hhmm: "18:05", kind: "time" });
  });

  it("limite com hora compacta vale como o por extenso", () => {
    expect(parsePontoExitAnswer("Saí depois das 18:30")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("depois das 18:30")).toEqual({
      kind: "ambiguous",
    });
    expect(parsePontoExitAnswer("saí até às 18h30")).toEqual({
      kind: "ambiguous",
    });
    // …e declarada sem operador continua hora exata.
    expect(parsePontoExitAnswer("saí às 18:30")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
  });

  it("hora compacta com qualificador de período obedece ao período", () => {
    expect(parsePontoExitAnswer("Saí às 8:30 da noite")).toEqual({
      hhmm: "20:30",
      kind: "time",
    });
    expect(parsePontoExitAnswer("saí às 8:30 da manhã")).toEqual({
      hhmm: "08:30",
      kind: "time",
    });
    // Qualificador impossível cai na leitura 24 h da forma compacta.
    expect(parsePontoExitAnswer("saí às 18:30 da manhã")).toEqual({
      hhmm: "18:30",
      kind: "time",
    });
    // Sem qualificador a compacta lê-se como antes.
    expect(parsePontoExitAnswer("saí às 8:30")).toEqual({
      hhmm: "08:30",
      kind: "time",
    });
  });
});
