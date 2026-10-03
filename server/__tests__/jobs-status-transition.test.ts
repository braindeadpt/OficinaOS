import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRoutes } from "../routes/jobs.js";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userHasPermission: vi.fn(),
  transitionStatus: vi.fn(),
  getById: vi.fn(),
  auditLogFindMany: vi.fn(),
  createJob: vi.fn(),
  listJobs: vi.fn(),
  getMetrics: vi.fn(),
  lookupByCode: vi.fn(),
  updateJob: vi.fn(),
  addNote: vi.fn(),
  listNotes: vi.fn(),
  addPart: vi.fn(),
  removePart: vi.fn(),
  addRepair: vi.fn(),
  removeRepair: vi.fn(),
  removePhoto: vi.fn(),
  uploadPhoto: vi.fn(),
  addWaitingPart: vi.fn(),
  removeWaitingPart: vi.fn(),
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn().mockReturnValue(new Headers()),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/job.service.js", () => ({
  transitionStatus: mocks.transitionStatus,
  getById: mocks.getById,
  create: mocks.createJob,
  list: mocks.listJobs,
  getMetrics: mocks.getMetrics,
  lookupByCode: mocks.lookupByCode,
  update: mocks.updateJob,
  getJobHistory: mocks.auditLogFindMany,
}));

vi.mock("../services/job-notes.service.js", () => ({
  add: mocks.addNote,
  list: mocks.listNotes,
}));

vi.mock("../services/job-parts.service.js", () => ({
  add: mocks.addPart,
  remove: mocks.removePart,
}));

vi.mock("../services/job-photos.service.js", () => ({
  upload: mocks.uploadPhoto,
  remove: mocks.removePhoto,
}));

vi.mock("../services/job-repairs.service.js", () => ({
  add: mocks.addRepair,
  remove: mocks.removeRepair,
}));

vi.mock("../services/job-waiting-parts.service.js", () => ({
  add: mocks.addWaitingPart,
  remove: mocks.removeWaitingPart,
}));

vi.mock("../middlewares/rbac.js", () => ({
  requirePermission: () => async (request: any) => {
    if (!request.user) {
      throw new AppError("UNAUTHORIZED");
    }
    const result = await request.server.auth.api.userHasPermission({
      body: {
        role: request.user.role,
        permissions: { jobs: ["view"] },
      },
    });
    if (!result.success) {
      throw new AppError("FORBIDDEN");
    }
  },
}));

function buildApp(userId: string | null, role = "OWNER") {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const payload: Record<string, unknown> = {
        code: error.code,
        message: error instanceof Error ? error.message : "Internal error",
      };
      if (error.details !== undefined) {
        payload.details = error.details;
      }
      reply.status(error.status).send(payload);
      return;
    }
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });

  const mockSession = userId
    ? {
        user: {
          id: userId,
          name: "Test",
          username: "test",
          email: "test@test.com",
          role,
          isActive: true,
          mustChangePassword: false,
        },
        session: { id: "sess-1" },
      }
    : null;

  mocks.getSession.mockResolvedValue(mockSession);
  mocks.userHasPermission.mockResolvedValue({ success: true });

  (app.decorate as (name: string, value: unknown) => void)("auth", {
    api: {
      getSession: mocks.getSession,
      userHasPermission: mocks.userHasPermission,
    },
  });

  (app.decorate as (name: string, value: unknown) => void)("prisma", {
    auditLog: { findMany: mocks.auditLogFindMany },
  });

  app.addHook("preHandler", async (request: any, _reply: any) => {
    const session = await app.auth.api.getSession({ headers: new Headers() });
    if (!session) {
      request.user = null;
      return;
    }
    request.user = session.user;
  });

  app.register(jobRoutes, { prefix: "/api/jobs" });
  return app;
}

describe("PATCH /api/jobs/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when CANCELLED sent without reason", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "CANCELLED" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.errors.reason).toBeDefined();
  });

  it("returns 400 when ON_HOLD sent without reason", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "ON_HOLD" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.errors.reason).toBeDefined();
  });

  it("returns 200 and persists reason for CANCELLED with reason", async () => {
    mocks.transitionStatus.mockResolvedValue({
      id: "job-1",
      status: "CANCELLED",
      finalCost: 0,
    });
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "CANCELLED", reason: "Customer requested" },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      { auditLog: { findMany: mocks.auditLogFindMany } },
      "job-1",
      "CANCELLED",
      "user-1",
      {
        prisma: { auditLog: { findMany: mocks.auditLogFindMany } },
        wsBroadcast: undefined,
      },
      { requestingRole: "OWNER", reason: "Customer requested" }
    );
  });

  it("returns 200 for routine transition without reason", async () => {
    mocks.transitionStatus.mockResolvedValue({
      id: "job-1",
      status: "IN_REPAIR",
      finalCost: 0,
    });
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "IN_REPAIR" },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      { auditLog: { findMany: mocks.auditLogFindMany } },
      "job-1",
      "IN_REPAIR",
      "user-1",
      {
        prisma: { auditLog: { findMany: mocks.auditLogFindMany } },
        wsBroadcast: undefined,
      },
      { requestingRole: "OWNER", reason: undefined }
    );
  });

  it("returns 400 when DONE sent without actualLaborHours", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: {
        status: "DONE",
        qcChecklist: {
          powersOn: "ok",
          screen: "ok",
          touch: "ok",
          cameras: "ok",
          audio: "ok",
          charging: "ok",
        },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.errors.actualLaborHours).toBeDefined();
  });

  it("returns 400 when DONE sent without qcChecklist", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "DONE", actualLaborHours: 1.5 },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.errors.qcChecklist).toBeDefined();
  });

  it("returns 400 when DONE sent with incomplete qcChecklist", async () => {
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: {
        status: "DONE",
        actualLaborHours: 1.5,
        qcChecklist: { powersOn: "ok", screen: "ok" },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details.errors.qcChecklist).toBeDefined();
  });

  it("returns 200 for DONE with labor hours and complete qcChecklist", async () => {
    mocks.transitionStatus.mockResolvedValue({
      id: "job-1",
      status: "DONE",
      finalCost: 0,
    });
    const qcChecklist = {
      powersOn: "ok",
      screen: "ok",
      touch: "ok",
      cameras: "ok",
      audio: "ok",
      charging: "ok",
    };
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "DONE", actualLaborHours: 1.5, qcChecklist },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.transitionStatus).toHaveBeenCalledWith(
      { auditLog: { findMany: mocks.auditLogFindMany } },
      "job-1",
      "DONE",
      "user-1",
      {
        prisma: { auditLog: { findMany: mocks.auditLogFindMany } },
        wsBroadcast: undefined,
      },
      {
        requestingRole: "OWNER",
        reason: undefined,
        actualLaborHours: 1.5,
        qcChecklist,
      }
    );
  });

  it("returns 403 FORBIDDEN_STATUS_TRANSITION when role lacks permission", async () => {
    const app = buildApp("user-1", "FRONT_DESK");
    mocks.userHasPermission.mockImplementation(({ body: { permissions } }) => {
      if (permissions.jobStatus) {
        return { success: false };
      }
      return { success: true };
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "IN_REPAIR" },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FORBIDDEN_STATUS_TRANSITION");
  });

  it("returns 409 CONFLICT_STATUS_TRANSITION for invalid transition", async () => {
    mocks.transitionStatus.mockResolvedValue({
      error: "CONFLICT_STATUS_TRANSITION",
      allowedTransitions: [],
      currentStatus: "DELIVERED",
    });
    const app = buildApp("user-1");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1/status",
      payload: { status: "IN_REPAIR" },
    });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("CONFLICT_STATUS_TRANSITION");
    expect(body.details.allowedTransitions).toEqual([]);
    expect(body.details.currentStatus).toBe("DELIVERED");
  });
});

describe("GET /api/jobs/:id/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns audit log entries ordered by desc", async () => {
    mocks.getById.mockResolvedValue({
      id: "job-1",
      status: "INTAKE",
      finalCost: 0,
    });
    const historyEntries = [
      {
        id: "log-2",
        action: "STATUS_CHANGED",
        createdAt: "2025-01-02T00:00:00Z",
        user: { id: "u1", name: "Admin", role: "OWNER" },
      },
      {
        id: "log-1",
        action: "JOB_CREATED",
        createdAt: "2025-01-01T00:00:00Z",
        user: { id: "u1", name: "Admin", role: "OWNER" },
      },
    ];
    mocks.auditLogFindMany.mockResolvedValue(historyEntries);

    const app = buildApp("user-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/jobs/job-1/history",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe("log-2");
    expect(mocks.auditLogFindMany).toHaveBeenCalledWith(app.prisma, "job-1");
  });
});
