import { describe, expect, it } from "vitest";
import {
  shopUtcOffsetLabel,
  shopWallTimeCandidates,
  shopWallTimeToUtc,
} from "../shared";

// Europe/Lisbon atrasa o relógio em 2025-10-26 (02:00→01:00, logo a hora
// 01:00–01:59 acontece duas vezes) e adianta em 2025-03-30 (01:00→02:00,
// logo a hora 01:00–01:59 não existe).
const TZ = "Europe/Lisbon";

describe("shopWallTimeCandidates", () => {
  it("devolve as duas ocorrências da hora repetida na saída do horário de verão", () => {
    const c = shopWallTimeCandidates(TZ, "2025-10-26", "01:30");
    expect(c.map((d) => d.toISOString())).toEqual([
      "2025-10-26T00:30:00.000Z",
      "2025-10-26T01:30:00.000Z",
    ]);
  });

  it("devolve um único instante para uma hora de parede normal", () => {
    const c = shopWallTimeCandidates(TZ, "2025-10-27", "01:30");
    expect(c.map((d) => d.toISOString())).toEqual(["2025-10-27T01:30:00.000Z"]);
  });

  it("devolve [] para uma hora que não existiu (mudança para o verão)", () => {
    expect(shopWallTimeCandidates(TZ, "2025-03-30", "01:30")).toHaveLength(0);
  });

  it("devolve [] para argumentos inválidos", () => {
    expect(shopWallTimeCandidates(TZ, "nope", "01:30")).toHaveLength(0);
    expect(shopWallTimeCandidates(TZ, "2025-10-26", "25:30")).toHaveLength(0);
  });

  it("shopWallTimeToUtc fica com a ocorrência mais cedo", () => {
    expect(shopWallTimeToUtc(TZ, "2025-10-26", "01:30")?.toISOString()).toBe(
      "2025-10-26T00:30:00.000Z"
    );
  });
});

describe("shopUtcOffsetLabel", () => {
  it("etiqueta cada ocorrência com o seu desvio UTC", () => {
    const c = shopWallTimeCandidates(TZ, "2025-10-26", "01:30");
    expect(c.map((d) => shopUtcOffsetLabel(TZ, d))).toEqual([
      "UTC+01:00",
      "UTC+00:00",
    ]);
  });
});
