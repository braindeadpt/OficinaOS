import { AppError } from "@shared/errors/app-error.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requirePermission } from "../../server/middlewares/rbac.js";

const mocks = vi.hoisted(() => ({
  userHasPermission: vi.fn(),
}));

function makeRequest(role: string | null, routeConfig?: object) {
  return {
    user: role ? { id: "u1", role, sessionId: "s1" } : null,
    routeOptions: { config: routeConfig ?? {} },
    server: { auth: { api: { userHasPermission: mocks.userHasPermission } } },
  } as unknown as Parameters<ReturnType<typeof requirePermission>>[0];
}

describe("requirePermission", () => {
  beforeEach(() => {
    mocks.userHasPermission.mockReset();
  });

  it("throws UNAUTHORIZED when no user on request", async () => {
    const handler = requirePermission({ jobs: ["view"] });
    await expect(handler(makeRequest(null), {} as never)).rejects.toThrow(
      AppError
    );
    await expect(handler(makeRequest(null), {} as never)).rejects.toThrow(
      "errors.unauthorized"
    );
    expect(mocks.userHasPermission).not.toHaveBeenCalled();
  });

  it("throws FORBIDDEN when userHasPermission.success is false", async () => {
    mocks.userHasPermission.mockResolvedValue({ success: false });
    const handler = requirePermission({ jobs: ["edit"] });
    await expect(
      handler(makeRequest("FRONT_DESK"), {} as never)
    ).rejects.toThrow(AppError);
    expect(mocks.userHasPermission).toHaveBeenCalledWith({
      body: { role: "FRONT_DESK", permissions: { jobs: ["edit"] } },
    });
  });

  it("passes through when userHasPermission.success is true", async () => {
    mocks.userHasPermission.mockResolvedValue({ success: true });
    const handler = requirePermission({ jobStatus: ["DELIVERED"] });
    await handler(makeRequest("FRONT_DESK"), {} as never);
  });

  it("skips the check on routes flagged config.public", async () => {
    const handler = requirePermission({ jobs: ["view"] });
    // Anonymous request on a public route — must not throw and must not
    // consult the permission API.
    await handler(makeRequest(null, { public: true }), {} as never);
    expect(mocks.userHasPermission).not.toHaveBeenCalled();
  });
});
