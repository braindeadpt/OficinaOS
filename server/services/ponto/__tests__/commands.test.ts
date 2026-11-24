import { describe, expect, it } from "vitest";
import { parsePontoCommand } from "../commands.js";

// Tabela §9 do plano: ≥30 variações → comando esperado. O parser nunca
// regista sem comando claro — ambíguo/não percebido → null.

describe("parsePontoCommand — comandos exatos e caixa", () => {
  const cases: [string, string][] = [
    ["ENTRADA", "ENTRADA"],
    ["entrada", "ENTRADA"],
    ["Entrada", "ENTRADA"],
    ["eNtRaDa", "ENTRADA"],
    ["PAUSA", "PAUSA"],
    ["pausa", "PAUSA"],
    ["Pausa!", "PAUSA"],
    ["VOLTEI", "VOLTEI"],
    ["voltei", "VOLTEI"],
    ["SAIDA", "SAIDA"],
    ["saida", "SAIDA"],
    ["saída", "SAIDA"],
    ["SAÍDA!!! 😤", "SAIDA"],
    ["ESTADO", "ESTADO"],
    ["estado", "ESTADO"],
  ];
  for (const [text, command] of cases) {
    it(`"${text}" → ${command}`, () => {
      expect(parsePontoCommand(text)?.command).toBe(command);
    });
  }
});

describe("parsePontoCommand — sinónimos PT-PT", () => {
  const cases: [string, string][] = [
    ["entrei", "ENTRADA"],
    ["cheguei", "ENTRADA"],
    ["bom dia", "ENTRADA"],
    ["Bom dia!", "ENTRADA"],
    ["intervalo", "PAUSA"],
    ["cafe", "PAUSA"],
    ["café", "PAUSA"],
    ["almoco", "PAUSA"],
    ["almoço", "PAUSA"],
    ["volta", "VOLTEI"],
    ["regresso", "VOLTEI"],
    ["REGRESSO", "VOLTEI"],
    ["fim", "VOLTEI"],
    ["FIM", "VOLTEI"],
    ["sai", "SAIDA"],
    ["saí", "SAIDA"],
    ["fui", "SAIDA"],
    ["adeus", "SAIDA"],
    ["horas", "ESTADO"],
  ];
  for (const [text, command] of cases) {
    it(`"${text}" → ${command}`, () => {
      expect(parsePontoCommand(text)?.command).toBe(command);
    });
  }
});

describe("parsePontoCommand — tolerância a erros (fuzzy ≤1, ≥5 letras)", () => {
  const cases: [string, string][] = [
    ["entarda", "ENTRADA"],
    ["entradas", "ENTRADA"],
    ["pausaa", "PAUSA"],
    ["paussa", "PAUSA"],
    ["intervaloo", "PAUSA"],
    ["volteii", "VOLTEI"],
    ["voltta", "VOLTEI"],
    ["regresoo", "VOLTEI"],
    ["saidad", "SAIDA"],
    ["horass", "ESTADO"],
  ];
  for (const [text, command] of cases) {
    it(`"${text}" → ${command}`, () => {
      expect(parsePontoCommand(text)?.command).toBe(command);
    });
  }
});

describe("parsePontoCommand — código de 4 dígitos e slug do QR", () => {
  const cases: [string, string | undefined][] = [
    ["ENTRADA 4821", "4821"],
    ["4821 entrada", "4821"],
    ["#4821 entrada", "4821"],
    ["entrada #4821", "4821"],
    ["ENTRADA oficina-do-rui 4821", "4821"],
    ["entrada Oficina do Rui #1234", "1234"],
    ["ENTRADA meu espaco comercial 9876", "9876"],
    ["PAUSA 4821", "4821"],
    // Sem "#", o ÚLTIMO token de 4 dígitos é o código — o fluxo do QR
    // é "ENTRADA <slug> #<codigo>" e um slug com números não o rouba.
    ["entrada 4821 9999", "9999"],
    ["ENTRADA loja 2024 4821", "4821"],
    // Com "#" o marcador ganha sempre — mesmo com dígitos a seguir.
    ["ENTRADA #4821 loja 2024", "4821"],
    ["ENTRADA loja 2024 #4821", "4821"],
  ];
  for (const [text, code] of cases) {
    it(`"${text}" → code ${code}`, () => {
      const parsed = parsePontoCommand(text);
      expect(parsed?.code).toBe(code);
    });
  }

  it("código de 5 dígitos não conta como código", () => {
    const parsed = parsePontoCommand("entrada 12345");
    expect(parsed?.command).toBe("ENTRADA");
    expect(parsed?.code).toBeUndefined();
  });

  it("tele-móvel de 9 dígitos não é código", () => {
    const parsed = parsePontoCommand("entrada 912345678");
    expect(parsed?.command).toBe("ENTRADA");
    expect(parsed?.code).toBeUndefined();
  });
});

describe("parsePontoCommand — botões interativos", () => {
  const cases: [string, string][] = [
    ["ponto_entrada", "ENTRADA"],
    ["ponto_pausa", "PAUSA"],
    ["ponto_voltei", "VOLTEI"],
    ["ponto_saida", "SAIDA"],
    ["PONTO_PAUSA", "PAUSA"],
  ];
  for (const [text, command] of cases) {
    it(`texto "${text}" → ${command}`, () => {
      expect(parsePontoCommand(text)?.command).toBe(command);
    });
  }

  it("interactiveId tem prioridade sobre texto irrelevante", () => {
    expect(parsePontoCommand("olá, bom dia", "ponto_saida")?.command).toBe(
      "SAIDA"
    );
  });

  it("interactiveId desconhecido não força comando", () => {
    expect(parsePontoCommand("PAUSA", "outro_botao")?.command).toBe("PAUSA");
  });
});

describe("parsePontoCommand — ambíguo ou não percebido → null", () => {
  const cases: (string | null | undefined)[] = [
    null,
    undefined,
    "",
    "   ",
    "obrigado",
    "bom",
    "dia",
    "entrada e saida",
    "pausa voltei",
    "entrada pausa",
    "nao saí",
    "nao quero entrada",
    "nunca fiz pausa",
    "fim de semana",
    "que horas são",
    "qual é o estado do tempo",
    "saída agora",
    "bom dia como estás",
    "ponto",
    "1234",
    "ponto_entrada extra",
    "voltei e já saí",
  ];
  for (const text of cases) {
    it(`"${text ?? "null"}" → null`, () => {
      expect(parsePontoCommand(text)).toBeNull();
    });
  }
});

describe("parsePontoCommand — casos de borda", () => {
  it("texto com emoji e pontuação normaliza", () => {
    expect(parsePontoCommand("  PAUSA!!! 🙏  ")?.command).toBe("PAUSA");
  });

  it("espaços múltiplos colapsam", () => {
    expect(parsePontoCommand("bom    dia")?.command).toBe("ENTRADA");
  });

  it("'bom dia' com código continua ENTRADA", () => {
    const parsed = parsePontoCommand("bom dia 4821");
    expect(parsed?.command).toBe("ENTRADA");
    expect(parsed?.code).toBe("4821");
  });

  it("palavra de dicionário com 4 letras não usa fuzzy ('cafee' ≠ PAUSA)", () => {
    expect(parsePontoCommand("cafee")).toBeNull();
  });

  it("palavra curta não usa fuzzy ('volt' ≠ VOLTEI)", () => {
    expect(parsePontoCommand("volt")).toBeNull();
  });

  it("'ate ja' não é comando (não está nos sinónimos)", () => {
    expect(parsePontoCommand("até já")).toBeNull();
  });

  it("dois comandos iguais são um só ('pausa pausa' → PAUSA)", () => {
    expect(parsePontoCommand("pausa pausa")?.command).toBe("PAUSA");
  });
});
