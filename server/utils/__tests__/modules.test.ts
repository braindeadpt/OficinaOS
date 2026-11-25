import { describe, expect, it } from "vitest";
import { HINT_TTL_MS, isModuleEnabled } from "../modules.js";

function row(entitlements: unknown, syncedAt: Date | null) {
  return { cloudEntitlements: entitlements, cloudSyncedAt: syncedAt };
}

describe("isModuleEnabled", () => {
  it("módulo na lista com sync fresco → ativo", () => {
    expect(isModuleEnabled(row(["sms"], new Date()), "sms")).toBe(true);
  });

  it("módulo fora da lista → inativo mesmo com sync fresco", () => {
    expect(isModuleEnabled(row(["sms"], new Date()), "whatsapp-bot")).toBe(
      false
    );
  });

  it("sem cloudSyncedAt → inativo", () => {
    expect(isModuleEnabled(row(["sms"], null), "sms")).toBe(false);
    expect(isModuleEnabled(null, "sms")).toBe(false);
    expect(isModuleEnabled(undefined, "sms")).toBe(false);
  });

  it("cache com mais de 24h → inativo", () => {
    const stale = new Date(Date.now() - HINT_TTL_MS - 1000);
    expect(isModuleEnabled(row(["sms"], stale), "sms")).toBe(false);
  });

  it("cache mesmo a expirar (<24h) → ativo", () => {
    const almost = new Date(Date.now() - HINT_TTL_MS + 60_000);
    expect(isModuleEnabled(row(["sms"], almost), "sms")).toBe(true);
  });

  it("cloudSyncedAt 1h no FUTURO → inativo (WP0.5)", () => {
    // Relógio mal ajustado ou manipulação: a diferença negativa passava
    // sempre no teste de frescura e os módulos nunca expiravam.
    const future = new Date(Date.now() + 3600 * 1000);
    expect(isModuleEnabled(row(["sms"], future), "sms")).toBe(false);
  });

  it("skew pequeno (≤5 min) no futuro → ainda fresco", () => {
    const skew = new Date(Date.now() + 4 * 60 * 1000);
    expect(isModuleEnabled(row(["sms"], skew), "sms")).toBe(true);
  });

  it("skew mesmo no limite (5 min) → ainda fresco", () => {
    const edge = new Date(Date.now() + 5 * 60 * 1000 - 1000);
    expect(isModuleEnabled(row(["sms"], edge), "sms")).toBe(true);
  });

  it("entitlements que não são array → inativo", () => {
    expect(isModuleEnabled(row("sms", new Date()), "sms")).toBe(false);
    expect(isModuleEnabled(row(null, new Date()), "sms")).toBe(false);
  });
});
