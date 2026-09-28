import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  create,
  getById,
  list,
  toggleActive,
  update,
} from "../parts-catalog.service";

function mockPrisma() {
  return {
    partsCatalog: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      // Field-reference sentinel for column-to-column comparisons
      fields: { reorderLevel: "partsCatalog.reorderLevel" },
    },
  } as unknown as PrismaClient;
}

describe("list", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns parts with pagination", async () => {
    const mockParts = [
      { id: "1", name: "Screen iPhone 14", category: "SCREEN", isActive: true },
      { id: "2", name: "Battery Samsung", category: "BATTERY", isActive: true },
    ];
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue(mockParts);
    (prisma.partsCatalog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      2
    );

    const result = await list(prisma, {
      category: undefined,
      cursor: undefined,
      isActive: undefined,
      limit: 10,
      search: undefined,
    });

    expect(result.parts).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.nextCursor).toBeNull();
  });

  it("filters by category", async () => {
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (prisma.partsCatalog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      0
    );

    await list(prisma, {
      category: "SCREEN",
      cursor: undefined,
      isActive: undefined,
      limit: 10,
      search: undefined,
    });

    const findManyCall = (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(findManyCall[0].where.category).toBe("SCREEN");
  });

  it("filters by isActive", async () => {
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (prisma.partsCatalog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      0
    );

    await list(prisma, {
      category: undefined,
      cursor: undefined,
      isActive: true,
      limit: 10,
      search: undefined,
    });

    const findManyCall = (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(findManyCall[0].where.isActive).toBe(true);
  });

  it("filters parts needing restock via column comparison", async () => {
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (prisma.partsCatalog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      0
    );

    await list(prisma, {
      category: undefined,
      cursor: undefined,
      isActive: undefined,
      limit: 10,
      needsRestock: true,
      search: undefined,
    });

    const findManyCall = (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    // Column-to-column comparison (stockQuantity <= reorderLevel) plus the
    // "a reorder level is configured" guard.
    expect(findManyCall[0].where.AND).toEqual([
      { reorderLevel: { gt: 0 } },
      {
        stockQuantity: {
          lte: prisma.partsCatalog.fields.reorderLevel,
        },
      },
    ]);
  });

  it("searches by name", async () => {
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (prisma.partsCatalog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      0
    );

    await list(prisma, {
      category: undefined,
      cursor: undefined,
      isActive: undefined,
      limit: 10,
      search: "iPhone",
    });

    const findManyCall = (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(findManyCall[0].where.name).toEqual({
      contains: "iPhone",
      mode: "insensitive",
    });
  });

  it("sets nextCursor when more results exist", async () => {
    const mockParts = new Array(11).fill(null).map((_, i) => ({
      category: "SCREEN",
      id: String(i + 1),
      isActive: true,
      name: `Part ${i + 1}`,
    }));
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([...mockParts]);
    (prisma.partsCatalog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      11
    );

    const result = await list(prisma, {
      category: undefined,
      cursor: undefined,
      isActive: undefined,
      limit: 10,
      search: undefined,
    });

    expect(result.parts).toHaveLength(10);
    expect(result.nextCursor).toBe("11");
  });

  it("does not count when cursor is provided", async () => {
    (
      prisma.partsCatalog.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);

    const result = await list(prisma, {
      category: undefined,
      cursor: "100",
      isActive: undefined,
      limit: 10,
      search: undefined,
    });

    expect(result.totalCount).toBeNull();
    expect(prisma.partsCatalog.count).not.toHaveBeenCalled();
  });
});

describe("getById", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns part when found", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      category: "SCREEN",
      id: "part-1",
      name: "iPhone Screen",
    });

    const result = await getById(prisma, "part-1");

    expect(result).toHaveProperty("id", "part-1");
    expect(result).toHaveProperty("name", "iPhone Screen");
  });

  it("returns null when not found", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const result = await getById(prisma, "non-existent");

    expect(result).toBeNull();
  });
});

describe("create", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("creates part with correct data", async () => {
    (prisma.partsCatalog.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      category: "SCREEN",
      defaultPrice: 150,
      id: "part-1",
      name: "iPhone 14 Screen",
      supplier: "Apple",
    });

    const result = await create(prisma, {
      category: "SCREEN",
      defaultPrice: 150,
      name: "iPhone 14 Screen",
      supplier: "Apple",
    });

    expect(result).toHaveProperty("id", "part-1");
    expect(result).toHaveProperty("name", "iPhone 14 Screen");
  });

  it("creates part without optional supplier", async () => {
    (prisma.partsCatalog.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      category: "BATTERY",
      defaultPrice: 80,
      id: "part-2",
      name: "Generic Battery",
      supplier: null,
    });

    const result = await create(prisma, {
      category: "BATTERY",
      defaultPrice: 80,
      name: "Generic Battery",
    });

    expect(result).toHaveProperty("name", "Generic Battery");
    expect(result).toHaveProperty("supplier", null);
  });
});

describe("update", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when part not found", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const result = await update(prisma, "non-existent", { name: "New Name" });

    expect(result).toBeNull();
  });

  it("updates part with provided data", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "part-1",
      name: "Old Name",
    });
    (prisma.partsCatalog.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      defaultPrice: 200,
      id: "part-1",
      name: "New Name",
    });

    const result = await update(prisma, "part-1", {
      name: "New Name",
      defaultPrice: 200,
    });

    expect(result).toHaveProperty("name", "New Name");
    expect(result).toHaveProperty("defaultPrice", 200);
  });
});

describe("toggleActive", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when part not found", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    const result = await toggleActive(prisma, "non-existent", false);

    expect(result).toBeNull();
  });

  it("sets isActive to false", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "part-1",
      isActive: true,
    });
    (prisma.partsCatalog.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      isActive: false,
    });

    const result = await toggleActive(prisma, "part-1", false);

    const updateCall = (prisma.partsCatalog.update as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(updateCall[0].data.isActive).toBe(false);
    expect(result).toHaveProperty("isActive", false);
  });

  it("sets isActive to true", async () => {
    (
      prisma.partsCatalog.findUnique as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "part-1",
      isActive: false,
    });
    (prisma.partsCatalog.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "part-1",
      isActive: true,
    });

    const result = await toggleActive(prisma, "part-1", true);

    expect(result).toHaveProperty("isActive", true);
  });
});
