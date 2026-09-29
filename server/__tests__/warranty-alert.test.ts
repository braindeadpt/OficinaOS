import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRoutes } from "../routes/jobs.js";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userHasPermission: vi.fn(),
  createJob: vi.fn(),
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn().mockReturnValue(new Headers()),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/job.service.js", () => ({
  create: mocks.createJob,
  transitionStatus: vi.fn(),
  getById: vi.fn(),
  list: vi.fn(),
  getMetrics: vi.fn(),
  lookupByCode: vi.fn(),
  update: vi.fn(),
  computeMargin: vi.fn().mockReturnValue(0),
}));

vi.mock("../services/notification-dispatch.js", () => ({
  notify: mocks.notify,
}));

vi.mock("../services/job-notes.service.js", () => ({
  add: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../services/job-parts.service.js", () => ({
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../services/job-photos.service.js", () => ({
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../services/job-repairs.service.js", () => ({
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../services/job-waiting-parts.service.js", () => ({
  add: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../middlewares/rbac.js", () => ({
  requirePermission: () => async (request: any) => {
    if (!request.user) {
      throw new AppError("UNAUTHORIZED");
    }
    await request.server.auth.api.userHasPermission({
      body: { role: request.user.role, permissions: { jobs: ["view"] } },
    });
  },
}));

function buildApp() {
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

  mocks.getSession.mockResolvedValue({
    user: {
      id: "u1",
      name: "Owner",
      role: "OWNER",
      email: "o@t.com",
      isActive: true,
      mustChangePassword: false,
    },
    session: { id: "s1" },
  });
  mocks.userHasPermission.mockResolvedValue({ success: true });

  (app.decorate as (name: string, value: unknown) => void)("auth", {
    api: {
      getSession: mocks.getSession,
      userHasPermission: mocks.userHasPermission,
    },
  });

  (app.decorate as (name: string, value: unknown) => void)("prisma", {});

  app.addHook("preHandler", async (request: any) => {
    const session = await app.auth.api.getSession({ headers: new Headers() });
    request.user = session?.user ?? null;
  });

  app.register(jobRoutes, { prefix: "/api/jobs" });

  return { app };
}

describe("Warranty return notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls notify when warranty return is created", async () => {
    mocks.createJob.mockResolvedValue({
      customer: { name: "Test", phone: "+1234567890" },
      id: "job-1",
      isWarrantyReturn: true,
      jobCode: "RPR-001",
    });

    const { app } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: {
        reportedProblem: "Broken again",
        deviceBrand: "Apple",
        deviceModel: "iPhone 15",
        estimatedCost: 5000,
        customerName: "Test",
        customerPhone: "+1234567890",
        isWarrantyReturn: true,
        warrantyForJobId: "original-job",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: {
          customerName: "Test",
          jobCode: "RPR-001",
          recipientPhone: "+1234567890",
        },
        eventName: "warranty_return_created",
        jobId: "job-1",
        recipients: { role: "OWNER" },
      })
    );
  });

  it("still notifies in-app when the created job has no customer attached", async () => {
    mocks.createJob.mockResolvedValue({
      customer: null,
      id: "job-3",
      isWarrantyReturn: true,
      jobCode: "RPR-003",
    });

    const { app } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: {
        reportedProblem: "Broken again",
        deviceBrand: "Apple",
        deviceModel: "iPhone 15",
        estimatedCost: 5000,
        customerName: "Test",
        customerPhone: "+1234567890",
        isWarrantyReturn: true,
        warrantyForJobId: "original-job",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: { jobCode: "RPR-003" },
        eventName: "warranty_return_created",
        jobId: "job-3",
        recipients: { role: "OWNER" },
      })
    );
  });

  it("does not call notify when job is not a warranty return", async () => {
    mocks.createJob.mockResolvedValue({
      id: "job-2",
      isWarrantyReturn: false,
      jobCode: "RPR-002",
    });

    const { app } = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: {
        reportedProblem: "Broken screen",
        deviceBrand: "Samsung",
        deviceModel: "Galaxy S24",
        estimatedCost: 3000,
        customerName: "Test",
        customerPhone: "+1234567890",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.notify).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: "warranty_return_created",
      })
    );
  });
});
