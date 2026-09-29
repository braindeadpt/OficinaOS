import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create, list, search, update } from "../customers.service";

function mockPrisma() {
  return {
    customer: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe("create", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("upserts customer by phone number", async () => {
    (prisma.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: "test@example.com",
      id: "cust-1",
      name: "John Doe",
      phone: "+1234567890",
    });

    const result = await create(prisma, {
      email: "test@example.com",
      name: "John Doe",
      phone: "+1234567890",
    });

    expect(result).toHaveProperty("id", "cust-1");
    expect(prisma.customer.upsert).toHaveBeenCalled();
  });

  it("trims email and handles empty string as null", async () => {
    (prisma.customer.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      email: undefined,
      id: "cust-1",
      name: "Jane Doe",
      phone: "+0987654321",
    });

    await create(prisma, {
      email: "  ",
      name: "Jane Doe",
      phone: "+0987654321",
    });

    const upsertCall = (prisma.customer.upsert as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(upsertCall[0].create.email).toBeNull();
  });
});

describe("update", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when customer not found", async () => {
    (prisma.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    const result = await update(prisma, "non-existent", { name: "New Name" });

    expect(result).toBeNull();
  });

  it("updates only provided fields", async () => {
    (prisma.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cust-1",
      name: "Old Name",
    });
    (prisma.customer.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cust-1",
      name: "New Name",
    });

    await update(prisma, "cust-1", { name: "New Name" });

    const updateCall = (prisma.customer.update as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(updateCall[0].data).toHaveProperty("name", "New Name");
    expect(updateCall[0].data).not.toHaveProperty("email");
    expect(updateCall[0].data).not.toHaveProperty("phone");
  });

  it("returns existing customer when no updates provided", async () => {
    const existingCustomer = {
      email: "test@test.com",
      id: "cust-1",
      name: "Same Name",
      phone: "+1234567890",
    };
    (prisma.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      existingCustomer
    );

    const result = await update(prisma, "cust-1", {});

    expect(result).toEqual(existingCustomer);
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns customers with pagination", async () => {
    const mockCustomers = [
      {
        _count: { jobs: 2 },
        email: "a@test.com",
        id: "1",
        name: "Alice",
        phone: "+111",
      },
      {
        _count: { jobs: 0 },
        email: "b@test.com",
        id: "2",
        name: "Bob",
        phone: "+222",
      },
    ];
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockCustomers
    );
    (prisma.customer.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: undefined,
    });

    expect(result.customers).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.nextCursor).toBeNull();
  });

  it("searches by name or phone", async () => {
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
    (prisma.customer.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: "Alice",
    });

    const findManyCall = (prisma.customer.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(findManyCall[0].where.OR).toBeDefined();
    expect(findManyCall[0].where.OR).toHaveLength(2);
  });

  it("filters by whatsappConsent true for GDPR campaign lists", async () => {
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
    (prisma.customer.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      consent: "true",
      cursor: undefined,
      limit: 10,
      search: undefined,
    });

    const findManyCall = (prisma.customer.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(findManyCall[0].where.whatsappConsent).toBe(true);
  });

  it("filters by whatsappConsent false (includes never-asked customers)", async () => {
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
    (prisma.customer.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      consent: "false",
      cursor: undefined,
      limit: 10,
      search: undefined,
    });

    const findManyCall = (prisma.customer.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(findManyCall[0].where.whatsappConsent).toBe(false);
  });

  it("does not filter by consent when unset", async () => {
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );
    (prisma.customer.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await list(prisma, {
      cursor: undefined,
      limit: 10,
      search: undefined,
    });

    const findManyCall = (prisma.customer.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(findManyCall[0].where).not.toHaveProperty("whatsappConsent");
  });
});

describe("search", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("searches by name or phone", async () => {
    const mockResults = [
      { email: "john@test.com", id: "1", name: "John", phone: "+1234567890" },
    ];
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResults
    );

    const result = await search(prisma, {
      limit: 10,
      q: "john",
    });

    expect(result).toHaveLength(1);
    expect(prisma.customer.findMany).toHaveBeenCalled();
  });

  it("uses phone startsWith for phone searches", async () => {
    (prisma.customer.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      []
    );

    await search(prisma, {
      limit: 10,
      q: "+123",
    });

    const findManyCall = (prisma.customer.findMany as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(findManyCall[0].where.OR[1]).toEqual({
      phone: { startsWith: "+123" },
    });
  });
});
