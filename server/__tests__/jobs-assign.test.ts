import { isAppError } from "@shared/errors/app-error.js";
import { roles } from "@shared/permissions";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRoutes } from "../routes/jobs.js";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userHasPermission: vi.fn(),
  getById: vi.fn(),
  transitionStatus: vi.fn(),
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
  computeMargin: vi.fn().mockReturnValue(2000),
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

function buildApp(role: keyof typeof roles) {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({ code: error.code });
      return;
    }
    reply.status(500).send({ code: "INTERNAL_ERROR" });
  });

  mocks.userHasPermission.mockImplementation(
    ({ body }: { body: { role: keyof typeof roles; permissions: never } }) =>
      roles[body.role].authorize(body.permissions)
  );

  (app.decorate as (name: string, value: unknown) => void)("auth", {
    api: {
      getSession: mocks.getSession,
      userHasPermission: mocks.userHasPermission,
    },
  });
  (app.decorate as (name: string, value: unknown) => void)("prisma", {});

  app.addHook("preHandler", (request: any, _reply, done) => {
    request.user = { id: "user-1", role };
    done();
  });

  app.register(jobRoutes, { prefix: "/api/jobs" });
  return app;
}

describe("PATCH /api/jobs/:id — technician assignment access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateJob.mockResolvedValue({ id: "job-1" });
  });

  it.each([
    ["OWNER", { canAssign: true, canSelfAssign: true }],
    ["TECHNICIAN", { canAssign: false, canSelfAssign: true }],
    ["FRONT_DESK", { canAssign: false, canSelfAssign: false }],
  ] as const)("resolves %s access from the RBAC roles", async (role, access) => {
    const app = buildApp(role);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1",
      payload: { technicianId: "tech-2" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.updateJob).toHaveBeenCalledWith(
      {},
      "job-1",
      { technicianId: "tech-2" },
      "user-1",
      access
    );
  });

  it("returns 403 when the service rejects the assignment", async () => {
    mocks.updateJob.mockResolvedValue({ error: "FORBIDDEN" });
    const app = buildApp("TECHNICIAN");

    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1",
      payload: { technicianId: "tech-2" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("skips the assignment lookup when technicianId is absent", async () => {
    const app = buildApp("TECHNICIAN");

    const res = await app.inject({
      method: "PATCH",
      url: "/api/jobs/job-1",
      payload: { isUrgent: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.updateJob).toHaveBeenCalledWith(
      {},
      "job-1",
      { isUrgent: true },
      "user-1",
      undefined
    );
  });
});
