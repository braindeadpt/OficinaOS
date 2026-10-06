import { describe, expect, it, vi } from "vitest";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";

describe("getOrCreateShopSettings (fresh install)", () => {
  it("returns the existing row without writing", async () => {
    const row = { id: "default", shopName: "Oficina" };
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue(row),
        upsert: vi.fn(),
      },
    };
    await expect(getOrCreateShopSettings(prisma as never)).resolves.toBe(row);
    expect(prisma.shopSettings.upsert).not.toHaveBeenCalled();
  });

  it("creates the defaults row instead of throwing before shop setup", async () => {
    const created = { id: "default", shopName: "" };
    const prisma = {
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(created),
      },
    };
    await expect(getOrCreateShopSettings(prisma as never)).resolves.toBe(
      created
    );
    expect(prisma.shopSettings.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    });
  });
});
