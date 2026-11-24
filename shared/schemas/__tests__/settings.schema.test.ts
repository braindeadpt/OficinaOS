import { describe, expect, it } from "vitest";
import { updateShopSettingsSchema } from "../settings.schema";

describe("updateShopSettingsSchema — ponto fields", () => {
  it("accepts a full ponto payload", () => {
    const parsed = updateShopSettingsSchema.safeParse({
      pontoExitReminderTime: "18:30",
      pontoExternalAutoApprove: false,
      pontoExternalPhotoRequired: true,
      pontoGeoLat: 38.7223,
      pontoGeoLng: -9.1393,
      pontoInfoText: "Aviso RGPD",
      pontoPauseReminderMinutes: 30,
      pontoRadiusM: 150,
      pontoSmsNumber: "+351210000000",
      pontoWaNumber: "+351912345678",
    });
    expect(parsed.success).toBe(true);
  });

  it("counts ponto fields as at least one field", () => {
    expect(
      updateShopSettingsSchema.safeParse({ pontoRadiusM: 200 }).success
    ).toBe(true);
    expect(updateShopSettingsSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a half-configured geo pair", () => {
    expect(
      updateShopSettingsSchema.safeParse({ pontoGeoLat: 38.7 }).success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoGeoLng: -9.1 }).success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({
        pontoGeoLat: 38.7,
        pontoGeoLng: null,
      }).success
    ).toBe(false);
    // null+null clears the pair and is allowed.
    expect(
      updateShopSettingsSchema.safeParse({
        pontoGeoLat: null,
        pontoGeoLng: null,
      }).success
    ).toBe(true);
  });

  it("validates lat/lng bounds", () => {
    expect(
      updateShopSettingsSchema.safeParse({
        pontoGeoLat: 91,
        pontoGeoLng: 0,
      }).success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({
        pontoGeoLat: 0,
        pontoGeoLng: 181,
      }).success
    ).toBe(false);
  });

  it("validates the reminder time format and allows clearing it", () => {
    expect(
      updateShopSettingsSchema.safeParse({ pontoExitReminderTime: "25:00" })
        .success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoExitReminderTime: "9:30" })
        .success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoExitReminderTime: null })
        .success
    ).toBe(true);
    expect(
      updateShopSettingsSchema.safeParse({ pontoExitReminderTime: "" }).success
    ).toBe(true);
  });

  it("validates wa/sms numbers as E.164-ish and allows empty", () => {
    expect(
      updateShopSettingsSchema.safeParse({ pontoWaNumber: "912345678" }).success
    ).toBe(true);
    expect(
      updateShopSettingsSchema.safeParse({ pontoWaNumber: "+351 912 345 678" })
        .success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoSmsNumber: "abc" }).success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoWaNumber: "" }).success
    ).toBe(true);
  });

  it("bounds radius and pause reminder", () => {
    expect(
      updateShopSettingsSchema.safeParse({ pontoRadiusM: 5 }).success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoRadiusM: 5000 }).success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoPauseReminderMinutes: 1 })
        .success
    ).toBe(false);
    expect(
      updateShopSettingsSchema.safeParse({ pontoPauseReminderMinutes: 200 })
        .success
    ).toBe(false);
  });
});
