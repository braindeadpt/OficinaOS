// buildPontoConfigPayload — o payload que a app empurra para a Cloud
// (PUT /ponto/config, contrato WP0.1). Puro: testa-se diretamente.

import { describe, expect, it } from "vitest";
import { buildPontoConfigPayload } from "../config-sync.js";

function settings(over: Record<string, unknown> = {}) {
  return {
    pontoExternalAutoApprove: true,
    pontoExternalPhotoRequired: false,
    pontoGeoLat: 38.72,
    pontoGeoLng: -9.14,
    pontoRadiusM: 100,
    pontoSmsNumber: "+351210000000",
    pontoWaNumber: "+351912345678",
    timezone: "Europe/Lisbon",
    ...over,
  };
}

describe("buildPontoConfigPayload", () => {
  it("monta geo/flags/timezone a partir das definições", () => {
    const payload = buildPontoConfigPayload(settings(), []);
    expect(payload).toEqual({
      externalAutoApprove: true,
      photoRequired: false,
      shopGeo: { lat: 38.72, lng: -9.14, radiusM: 100 },
      smsNumber: "+351210000000",
      staff: [],
      timezone: "Europe/Lisbon",
      waNumber: "+351912345678",
    });
  });

  it("shopGeo é null sem o par lat/lng — a Cloud limpa a geo", () => {
    for (const over of [
      { pontoGeoLat: null },
      { pontoGeoLng: null },
      { pontoGeoLat: null, pontoGeoLng: null },
    ]) {
      expect(buildPontoConfigPayload(settings(over), []).shopGeo).toBeNull();
    }
  });

  it("timezone cai para env TZ/UTC quando a loja não a definiu", () => {
    const payload = buildPontoConfigPayload(settings({ timezone: null }), []);
    expect(typeof payload.timezone).toBe("string");
    expect(payload.timezone.length).toBeGreaterThan(0);
  });

  it("staff inclui internos e externos; sem phoneE164 ficam de fora", () => {
    const payload = buildPontoConfigPayload(settings(), [
      {
        externalWork: false,
        phoneE164: "+351911111111",
        pontoSmsAllowed: true,
      },
      {
        externalWork: true,
        phoneE164: "+351922222222",
        pontoSmsAllowed: false,
      },
      { externalWork: false, phoneE164: null, pontoSmsAllowed: false },
    ]);
    expect(payload.staff).toEqual([
      { externalWork: false, phone: "+351911111111", smsAllowed: true },
      { externalWork: true, phone: "+351922222222", smsAllowed: false },
    ]);
  });
});
