/** Teletrabalho (R3 AIPD): dia de teletrabalho nunca pede localização;
 * dia normal segue o fluxo de sempre; o kind certo sai na exportação. */
import { describe, expect, it } from "vitest";
import { isTeleworkDay } from "../telework.js";

describe("isTeleworkDay", () => {
  const tz = "Europe/Lisbon";
  it("dia marcado → teletrabalho", () => {
    // 2026-11-30 é segunda-feira (ISO 1)
    expect(isTeleworkDay([1], tz, new Date("2026-11-30T10:00:00Z"))).toBe(true);
  });
  it("dia não marcado → falso", () => {
    expect(isTeleworkDay([2, 3], tz, new Date("2026-11-30T10:00:00Z"))).toBe(
      false
    );
  });
  it("vazio → nunca", () => {
    expect(isTeleworkDay([], tz, new Date("2026-11-30T10:00:00Z"))).toBe(false);
    expect(isTeleworkDay(null, tz, new Date())).toBe(false);
  });
  it("todos os dias → sempre", () => {
    expect(
      isTeleworkDay([1, 2, 3, 4, 5, 6, 7], tz, new Date("2026-11-29T10:00:00Z"))
    ).toBe(true);
  });
});
