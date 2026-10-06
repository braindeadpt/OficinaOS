import { describe, expect, it, vi } from "vitest";
import { resolveTechnicianNames } from "../technician-names.js";

function mockPrisma(
  users: Array<{ id: string; name: string; username: string }>
) {
  return {
    user: { findMany: vi.fn().mockResolvedValue(users) },
  } as unknown as Parameters<typeof resolveTechnicianNames>[0];
}

describe("resolveTechnicianNames", () => {
  it("replaces technician IDs with names on assignment entries", async () => {
    const prisma = mockPrisma([
      { id: "VLog9abc", name: "Rui", username: "rui" },
      { id: "u-2", name: "", username: "ana" },
    ]);
    const result = await resolveTechnicianNames(prisma, [
      { action: "TECHNICIAN_ASSIGNED", fromValue: "u-2", toValue: "VLog9abc" },
      {
        action: "TECHNICIAN_ASSIGNED",
        fromValue: "VLog9abc",
        toValue: "unassigned",
      },
      { action: "STATUS_CHANGED", fromValue: "RECEIVED", toValue: "VLog9abc" },
    ]);
    expect(result[0]).toMatchObject({ fromValue: "ana", toValue: "Rui" });
    expect(result[1]).toMatchObject({
      fromValue: "Rui",
      toValue: "unassigned",
    });
    expect(result[2].toValue).toBe("VLog9abc");
  });

  it("leaves an unknown ID as is and skips the query when nothing to resolve", async () => {
    const prisma = mockPrisma([]);
    const noop = await resolveTechnicianNames(prisma, [
      { action: "STATUS_CHANGED", toValue: "READY" },
    ]);
    expect(noop[0].toValue).toBe("READY");
    expect(prisma.user.findMany).not.toHaveBeenCalled();

    const gone = await resolveTechnicianNames(prisma, [
      { action: "TECHNICIAN_ASSIGNED", toValue: "deleted-user" },
    ]);
    expect(gone[0].toValue).toBe("deleted-user");
  });
});
