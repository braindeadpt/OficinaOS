import { describe, expect, it } from "vitest";
import { gsm7Septets, smsSegmentCount, staffSmsText, toSmsText } from "./gsm7";

describe("toSmsText", () => {
  it("transliterates Portuguese accents to GSM-7 base letters", () => {
    expect(toSmsText("atenção")).toBe("atencao");
    expect(toSmsText("coração")).toBe("coracao");
    expect(toSmsText("São Paulo")).toBe("Sao Paulo");
    expect(toSmsText("preço")).toBe("preco");
    expect(toSmsText("obrigado")).toBe("obrigado");
  });

  it("keeps GSM-7 legal accented chars that need no mapping", () => {
    expect(toSmsText("café")).toBe("café");
    expect(toSmsText("às 18h")).toBe("às 18h");
  });

  it("maps smart punctuation and drops unknowns to ?", () => {
    expect(toSmsText("“olá”")).toBe('"ola"');
    expect(toSmsText("100€")).toBe("100€");
  });

  it("leaves plain ASCII untouched", () => {
    expect(toSmsText("REP-2024-000001-ABC esta pronto")).toBe(
      "REP-2024-000001-ABC esta pronto"
    );
  });
});

describe("gsm7Septets / smsSegmentCount", () => {
  it("counts 160 chars as one segment", () => {
    expect(gsm7Septets("a".repeat(160))).toBe(160);
    expect(smsSegmentCount("a".repeat(160))).toBe(1);
  });

  it("counts extension chars as 2 septets", () => {
    expect(gsm7Septets("100€")).toBe(5);
  });

  it("two segments above 160 septets", () => {
    expect(smsSegmentCount("a".repeat(161))).toBe(2);
  });

  it("non-GSM text falls back to UCS-2 (70/segment)", () => {
    expect(smsSegmentCount(`${"a".repeat(70)}ã`)).toBe(2);
    expect(smsSegmentCount("ã".repeat(70))).toBe(1);
  });
});

describe("staffSmsText", () => {
  it("keeps accents when it fits one segment", () => {
    const msg = "Obrigado — fica atenção incluída";
    expect(staffSmsText(msg)).toBe(msg);
  });

  it("transliterates when accents would force a second segment", () => {
    const msg = `Ótimo ${"x".repeat(72)}ã`;
    const out = staffSmsText(msg);
    expect(out).toBe(toSmsText(msg));
    expect(smsSegmentCount(out)).toBe(1);
  });
});

describe("NBSP em preços", () => {
  it("non-breaking space antes do € vira espaço normal, não '?'", () => {
    // Intl.NumberFormat pt-PT usa U+00A0 — sem normalização saía "100,00?€".
    const formatted = new Intl.NumberFormat("pt-PT", {
      currency: "EUR",
      style: "currency",
    }).format(100);
    expect(toSmsText(formatted)).toBe("100,00 €");
  });
});
