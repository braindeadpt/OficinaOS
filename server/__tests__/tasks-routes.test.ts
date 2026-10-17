import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { tasksRoutes } from "../routes/tasks.js";

function buildApp(canEditSettings: boolean) {
  const app = Fastify();
  const findMany = vi.fn(async () => []);
  app.decorate("prisma", {
    job: { findUnique: vi.fn(async () => ({ id: "j1" })) },
    taskRule: { findMany },
    workshopTask: { findMany },
  } as never);
  app.decorate("auth", {
    api: {
      userHasPermission: ({
        body,
      }: {
        body: { permissions: { settings?: string[] } };
      }) =>
        Promise.resolve({
          success: !body.permissions.settings || canEditSettings,
        }),
    },
  } as never);
  app.addHook("onRequest", (req, _reply, done) => {
    req.user = { id: "u1", role: "TECHNICIAN" } as never;
    done();
  });
  app.setErrorHandler((error, _req, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({ code: error.code });
    } else {
      reply.status(500).send({ code: "INTERNAL_ERROR" });
    }
  });
  app.register(tasksRoutes, { prefix: "/api/tasks" });
  return { app, findMany };
}

describe("task routes", () => {
  it("does not let a technician administer automation rules", async () => {
    const { app, findMany } = buildApp(false);
    const res = await app.inject({ method: "GET", url: "/api/tasks/rules" });
    expect(res.statusCode).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
    await app.close();
  });
  it("validates the state and delay before storing a rule", async () => {
    const { app } = buildApp(true);
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/rules",
      payload: {
        title: "Order part",
        triggerStatus: "invented",
        delayHours: -1,
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
  it("filters the task list by the repair", async () => {
    const { app, findMany } = buildApp(false);
    const res = await app.inject({ method: "GET", url: "/api/tasks?jobId=j1" });
    expect(res.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ jobId: "j1", completedAt: null }),
      })
    );
    await app.close();
  });
});
