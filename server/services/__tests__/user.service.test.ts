import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createUser,
  getActivity,
  resetPassword,
  toggleStatus,
  updateUserProfileService,
} from "../user.service.js";

function mockPrisma() {
  const mock = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
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

describe("updateUserProfileService placeholder name", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.update.mockImplementation(
      ({ data }: { data: Record<string, string> }) => ({ id: "u-1", ...data })
    );
  });

  it("renames a seeded 'Admin' name along with the username", async () => {
    prisma.user.findUnique.mockResolvedValue({
      name: "Admin",
      username: "admin",
    });

    await updateUserProfileService(prisma, "u-1", {
      name: "Admin",
      username: "pedro",
    });

    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      name: "pedro",
      username: "pedro",
    });
  });

  it("keeps a real name when the username changes", async () => {
    prisma.user.findUnique.mockResolvedValue({
      name: "Pedro Póvoas",
      username: "admin",
    });

    await updateUserProfileService(prisma, "u-1", {
      name: "Pedro Póvoas",
      username: "pedro",
    });

    expect(prisma.user.update.mock.calls[0][0].data.name).toBe("Pedro Póvoas");
  });

  it("keeps a name the user typed in the same save", async () => {
    prisma.user.findUnique.mockResolvedValue({
      name: "Admin",
      username: "admin",
    });

    await updateUserProfileService(prisma, "u-1", {
      name: "Ana",
      username: "ana_loja",
    });

    expect(prisma.user.update.mock.calls[0][0].data.name).toBe("Ana");
  });
});

describe("getActivity technician names", () => {
  it("shows the technician's name instead of their user ID", async () => {
    const prisma = mockPrisma();
    prisma.auditLog.findMany.mockResolvedValue([
      {
        action: "TECHNICIAN_ASSIGNED",
        createdAt: new Date(),
        fromValue: null,
        id: "log-1",
        toValue: "VLog9abc",
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: "VLog9abc", name: "Rui Tecnico", username: "rui" },
    ]);

    const result = await getActivity(prisma, "u-1", { limit: 20 } as never);

    expect(result.items[0].toValue).toBe("Rui Tecnico");
  });
});
