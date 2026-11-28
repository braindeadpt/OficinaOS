import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import {
  REGISTOS_I18N,
  registosLang,
  registosMonthLabel,
  registosT,
} from "../registos-i18n.js";
import { buildRegistosPdf } from "../registos-pdf.js";

// REGISTOS na língua documental da loja (b): o pt tem de ser byte a byte
// o que sempre foi — as âncoras abaixo copiam as frases que estavam
// hardcoded antes da extração, para que uma edição futura no pt seja uma
// decisão consciente e não um acidente de refactor.

const TZ = "Europe/Lisbon";

function summarySample() {
  return {
    correctionsCount: 2,
    days: 5,
    entriesCount: 20,
    hasOpenShift: false,
    pauseMs: 30 * 60_000,
    pendingCount: 1,
    workedMs: 8 * 3_600_000 + 15 * 60_000,
  };
}

function entrySample() {
  return [
    {
      at: new Date("2026-10-05T08:30:00.000Z"),
      status: "APROVADO",
      superseded: false,
      type: "ENTRADA",
      validations: [],
    },
  ];
}

/** Extrai o texto visível do PDF — o conteúdo é WinAnsi/cp1252 (o
 *  travessão e as aspas tipográficas vivem no intervalo 0x80-0x9F, que
 *  latin-1 não mapeia de volta). */
function pdfText(buf: Buffer): string {
  return iconv.decode(buf, "win1252");
}

describe("registosLang", () => {
  it("omisso ou desconhecido cai em pt (loja PT histórica)", () => {
    expect(registosLang(undefined)).toBe("pt");
    expect(registosLang(null)).toBe("pt");
  });

  it("normaliza locales soltos para a língua documental", () => {
    expect(registosLang("pt-PT")).toBe("pt");
    expect(registosLang("fr-FR")).toBe("fr");
    expect(registosLang("es")).toBe("es");
    expect(registosLang("en-GB")).toBe("en");
  });
});

describe("registosMonthLabel", () => {
  const spec = { month: 10, year: 2026 };

  it("pt mantém «outubro de 2026» — o mesmo texto do array hardcoded", () => {
    expect(registosMonthLabel(spec, "pt")).toBe("outubro de 2026");
  });

  it("cada língua usa a sua forma nativa", () => {
    expect(registosMonthLabel(spec, "en")).toBe("October 2026");
    expect(registosMonthLabel(spec, "es")).toBe("octubre de 2026");
    expect(registosMonthLabel(spec, "fr")).toBe("octobre 2026");
  });
});

describe("pt — âncoras de regressão (byte a byte o texto anterior)", () => {
  const pt = REGISTOS_I18N.pt;

  it("frases do comando", () => {
    expect(pt.invalidMonth).toBe(
      "Mês inválido — escreva REGISTOS ou REGISTOS MM/AAAA (ex.: REGISTOS 10/2026), sem meses futuros."
    );
    expect(pt.rateLimited).toBe(
      "Atingiu o limite de 5 pedidos de registos por dia — tente novamente amanhã."
    );
    expect(pt.noEntries).toBe("Sem registos em {{month}}.");
    expect(pt.noUrl).toBe(
      "Não consigo gerar o link do PDF porque a loja não tem endereço configurado — peça o relatório ao responsável."
    );
    expect(pt.estimatedHours).toBe(
      "Inclui horas estimadas — há dias sem saída registada (contadas até agora no dia de hoje, até à meia-noite nos dias anteriores)."
    );
  });

  it("linhas do resumo interpoladas batem no formato anterior", () => {
    expect(registosT(pt.summaryTitle, { month: "outubro de 2026" })).toBe(
      "Os seus registos de outubro de 2026:"
    );
    expect(
      registosT(pt.summaryDays, {
        days: "5",
        pause: "0h30",
        worked: "8h15",
      })
    ).toBe("5 dia(s) · 8h15 trabalhadas · pausas 0h30");
    expect(
      registosT(pt.summaryCorrections, { corrections: "2", pending: "1" })
    ).toBe("2 correção(ões) · 1 por validar");
    expect(registosT(pt.pdfLinkLine, { url: "https://x/y" })).toBe(
      "PDF do mês (link de uso único, válido 24 h): https://x/y"
    );
  });

  it("frases do PDF", () => {
    expect(pt.pdfTitle).toBe("Registo de ponto — os meus registos");
    expect(pt.pdfFooter).toBe(
      "Documento pedido pelo próprio trabalhador (art. 15.º RGPD). Gerado automaticamente pela aplicação da loja."
    );
    expect(pt.pdfEmpty).toBe("Sem registos neste mês.");
    expect(pt.entryTypes.SAIDA).toBe("Saída");
    expect(pt.entryTypes.VOLTEI).toBe("Regresso");
    expect(pt.statuses.POR_VALIDAR).toBe("Por validar");
  });
});

describe("buildRegistosPdf — língua documental", () => {
  const base = {
    entries: entrySample(),
    monthLabel: "outubro de 2026",
    shopName: "Loja Teste",
    summary: summarySample(),
    tz: TZ,
    workerName: "Ana",
  };

  it("sem lang é o PDF pt de sempre", () => {
    const pdf = pdfText(buildRegistosPdf(base));
    expect(pdf).toContain("Registo de ponto — os meus registos");
    expect(pdf).toContain("Dias com registos: 5");
    expect(pdf).toContain("Entrada");
    expect(pdf).toContain("Aprovado");
  });

  it("lang pt explícito é idêntico ao omisso", () => {
    const omitido = buildRegistosPdf(base);
    const explicito = buildRegistosPdf({ ...base, lang: "pt" });
    expect(explicito.equals(omitido)).toBe(true);
  });

  it("fr gera o documento em francês", () => {
    const pdf = pdfText(
      buildRegistosPdf({ ...base, lang: "fr", monthLabel: "octobre 2026" })
    );
    expect(pdf).toContain("Pointage — mes enregistrements");
    expect(pdf).toContain("Jours avec enregistrements");
    expect(pdf).toContain("Entrée");
    expect(pdf).toContain("Approuvé");
    expect(pdf).not.toContain("Registo de ponto");
  });

  it("es gera o documento em espanhol", () => {
    const pdf = pdfText(
      buildRegistosPdf({ ...base, lang: "es", monthLabel: "octubre de 2026" })
    );
    expect(pdf).toContain("Registro de jornada — mis registros");
    expect(pdf).toContain("Días con registros: 5");
    expect(pdf).toContain("Aprobado");
  });

  it("en gera o documento em inglês", () => {
    const pdf = pdfText(
      buildRegistosPdf({ ...base, lang: "en", monthLabel: "October 2026" })
    );
    expect(pdf).toContain("Time clock record — my records");
    expect(pdf).toContain("Days with records: 5");
    expect(pdf).toContain("Clock-in");
    expect(pdf).toContain("Approved");
  });

  it("mês vazio usa a frase da língua", () => {
    const pdf = pdfText(buildRegistosPdf({ ...base, entries: [], lang: "fr" }));
    expect(pdf).toContain("Aucun enregistrement ce mois-ci.");
  });
});

describe("cobertura das quatro línguas", () => {
  it("todas as chaves existem em todas as línguas", () => {
    const ptKeys = Object.keys(REGISTOS_I18N.pt).sort();
    for (const lang of ["en", "es", "fr"] as const) {
      expect(Object.keys(REGISTOS_I18N[lang]).sort()).toEqual(ptKeys);
    }
  });
});
