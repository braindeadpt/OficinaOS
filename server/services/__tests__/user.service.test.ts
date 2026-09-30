import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, resetPassword, toggleStatus } from "../user.service.js";

function mockPrisma() {
  const mock = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mock)),
  };
  return mock as unknown as any;
}

const createData = {
  email: "new@example.com",
  password: "secret123",
  role: "OWNER",
  username: "newowner",
};

describe("createUser role guard", () => {
  let prisma: ReturnType<typeof mockPrisma>;
  const authApi = { createUser: vi.fn() };

  beforeEach(() => {
    prisma = mockPrisma();
    authApi.createUser.mockReset();
  });

  it("rejects OWNER creation by a non-owner caller", async () => {
    await expect(
      createUser(prisma, authApi, {}, createData, "u-caller", "FRONT_DESK")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(authApi.createUser).not.toHaveBeenCalled();
  });

  it("allows OWNER creation by an owner caller", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    authApi.createUser.mockResolvedValue({ user: { id: "u-new" } });
    prisma.user.findUnique.mockResolvedValue({ id: "u-new", role: "OWNER" });
    prisma.auditLog.create.mockResolvedValue({});

    const user = await createUser(
      prisma,
      authApi,
      {},
      createData,
      "u-caller",
      "OWNER"
    );
    expect(user).toMatchObject({ id: "u-new" });
  });
});

describe("toggleStatus target-role guard", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("rejects deactivating an OWNER by a non-owner caller", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u-owner", role: "OWNER" });

    await expect(
      toggleStatus(prisma, "u-owner", false, "FRONT_DESK")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows deactivating a non-owner target", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u-tech",
      role: "TECHNICIAN",
    });
    prisma.user.update.mockResolvedValue({ id: "u-tech", isActive: false });

    const result = await toggleStatus(prisma, "u-tech", false, "FRONT_DESK");
    expect(result).toMatchObject({ isActive: false });
  });
});

describe("resetPassword target-role guard", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("rejects resetting an OWNER password by a non-owner caller", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u-owner",
      role: "OWNER",
      username: "admin",
    });

    await expect(
      resetPassword(prisma, "u-owner", "newpass123", "u-caller", "FRONT_DESK")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
