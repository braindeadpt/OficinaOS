// buildPontoConfigPayload — o payload que a app empurra para a Cloud
// (PUT /ponto/config, contrato WP0.1). Puro: testa-se diretamente.

import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "../../../lib/crypto.js";
import {
  buildPontoConfigPayload,
  pushPontoCloudConfig,
} from "../config-sync.js";

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
      pinSyncVersion: 1,
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
      {
        externalWork: false,
        manualEntryAt: null,
        phone: "+351911111111",
        smsAllowed: true,
      },
      {
        externalWork: true,
        manualEntryAt: null,
        phone: "+351922222222",
        smsAllowed: false,
      },
    ]);
  });

  it("serializa manualEntryAt e a revogação explícita no contrato da Cloud", () => {
    const manualAt = new Date("2026-01-10T09:00:00.000Z");
    const revokeAt = new Date("2026-01-10T09:00:01.500Z");
    const payload = buildPontoConfigPayload(settings(), [
      {
        externalWork: false,
        manualEntryAt: manualAt,
        phoneE164: "+351911111111",
        pontoSmsAllowed: true,
        revokeEntryAt: revokeAt,
        revokedBy: "dono",
      },
    ]);

    expect(payload.staff).toEqual([
      {
        externalWork: false,
        manualEntryAt: manualAt.toISOString(),
        phone: "+351911111111",
        revokeEntryAt: revokeAt.toISOString(),
        revokedBy: "dono",
        smsAllowed: true,
      },
    ]);
  });
});

describe("pushPontoCloudConfig", () => {
  it("serializa pushes completos — o segundo lê a escala já atualizada", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    fetchMock
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() =>
        Promise.resolve(Response.json({ ok: true }))
      );
    const staffUsers = [
      {
        externalWork: false,
        id: "u-ana",
        phoneE164: "+351911111111",
        pontoSmsAllowed: true,
      },
    ];
    const prisma = {
      shopSettings: {
        findUnique: vi.fn(async () => ({
          cloudApiUrl: "https://cloud.test",
          cloudEntitlements: ["ponto"],
          cloudShopTokenEncrypted: encryptSecret("shop-token"),
          cloudSyncedAt: new Date(),
          pontoExternalAutoApprove: true,
          pontoExternalPhotoRequired: false,
          pontoGeoLat: 38.7,
          pontoGeoLng: -9.1,
          pontoRadiusM: 100,
          pontoSmsNumber: null,
          pontoWaNumber: null,
          timezone: "Europe/Lisbon",
        })),
      },
      timeEntry: { findMany: vi.fn(async () => []) },
      user: {
        findMany: vi.fn(async () => staffUsers.map((user) => ({ ...user }))),
      },
    };
    const log = { warn: vi.fn() } as never;

    try {
      const first = pushPontoCloudConfig(prisma as never, log);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      staffUsers.push({
        externalWork: false,
        id: "u-bruno",
        phoneE164: "+351922222222",
        pontoSmsAllowed: true,
      });

      const second = pushPontoCloudConfig(prisma as never, log);
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveFirst?.(Response.json({ ok: true }));
      await first;
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await second;

      const init = fetchMock.mock.calls[1][1] as { body: string };
      expect(
        JSON.parse(init.body).staff.map((row: { phone: string }) => row.phone)
      ).toEqual(["+351911111111", "+351922222222"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
