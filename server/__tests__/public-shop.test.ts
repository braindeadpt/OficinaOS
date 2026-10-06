import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseImageDataUrl, toPublicShop } from "../utils/public-shop.js";

const mocks = vi.hoisted(() => ({ getOrCreateShopSettings: vi.fn() }));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
}));

import { publicRoutes } from "../routes/public.js";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const baseSettings = {
  address: "Rua de Benfica 12, Lisboa",
  defaultWarrantyDays: 30,
  logoPath: null,
  phone: "+351 912 345 678",
  shopName: "TecFix Benfica",
  storeLogoData: null,
  // Private settings must never leak through the public endpoint.
  whatsappApiTokenEncrypted: "secret",
};

function buildApp() {
  const app = Fastify();
  (app.decorate as (name: string, value: unknown) => void)("prisma", {});
  app.register(publicRoutes, { prefix: "/api/public" });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toPublicShop", () => {
  it("exposes only the customer-facing identity", () => {
    expect(toPublicShop(baseSettings)).toEqual({
      address: "Rua de Benfica 12, Lisboa",
      logoUrl: null,
      name: "TecFix Benfica",
      phone: "+351 912 345 678",
      warrantyDays: 30,
    });
  });

  it("maps blanks to null and an uploaded logo to the logo route", () => {
    const shop = toPublicShop({
      ...baseSettings,
      address: "  ",
      phone: "",
      shopName: " ",
      storeLogoData: `data:image/png;base64,${PNG_1PX}`,
    });
    expect(shop.name).toBeNull();
    expect(shop.phone).toBeNull();
    expect(shop.address).toBeNull();
    expect(shop.logoUrl).toBe("/api/public/shop/logo");
  });

  it("ignores data URLs that are not images", () => {
    expect(parseImageDataUrl("data:text/html;base64,PGgxPg==")).toBeNull();
    expect(parseImageDataUrl(null)).toBeNull();
  });
});

describe("GET /api/public/shop", () => {
  it("serves the shop identity to anonymous visitors", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue(baseSettings);
    const res = await buildApp().inject({
      method: "GET",
      url: "/api/public/shop",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("TecFix Benfica");
    expect(body.warrantyDays).toBe(30);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("serves the uploaded logo as an image", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValue({
      ...baseSettings,
      storeLogoData: `data:image/png;base64,${PNG_1PX}`,
    });
    const res = await buildApp().inject({
      method: "GET",
      url: "/api/public/shop/logo",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
  });
});
