import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { purchaseOrdersRoutes } from "../routes/purchase-orders.js";
import { tasksRoutes } from "../routes/tasks.js";
import { workflowRoutes } from "../routes/workflow.js";

function buildApp({
  manageCatalog = true,
  settings = true,
  shopReturns = true,
  catalog = true,
} = {}) {
  const prisma = {
    job: { findUnique: vi.fn(async () => ({ id: "j1" })) },
    supplier: { findUnique: vi.fn(async () => ({ id: "s1" })) },
    returnClaim: {
      findMany: vi.fn(async () => [{ id: "visible-claim" }]),
      findUnique: vi.fn(async () => ({ id: "hidden-claim" })),
      findFirst: vi.fn(async () => null),
    },
    workshopTask: {
      findMany: vi.fn(async (_query: unknown) => []),
      findUnique: vi.fn(async () => ({
        entityType: "SUPPLIER",
        entityId: "s1",
      })),
      create: vi.fn(async ({ data }) => ({ id: "t1", ...data })),
      upsert: vi.fn(),
    },
    taskRule: { findMany: vi.fn(async (_query: unknown) => []) },
    workflowState: {
      create: vi.fn(),
      findFirst: vi.fn(async () => null),
      update: vi.fn(),
    },
    recordWorkflow: { upsert: vi.fn(), deleteMany: vi.fn() },
    purchaseOrder: {
      create: vi.fn(async ({ data }) => ({ id: "o1", ...data })),
    },
  };
  const app = Fastify();
  app.decorate("prisma", prisma as never);
  app.decorate("auth", {
    api: {
      userHasPermission: ({
        body,
      }: {
        body: {
          permissions: {
            parts?: string[];
            settings?: string[];
            returns?: string[];
          };
        };
      }) =>
        Promise.resolve({
          success: !(
            (body.permissions.parts?.includes("manageCatalog") &&
              !manageCatalog) ||
            (body.permissions.parts?.includes("viewCatalog") && !catalog) ||
            (body.permissions.settings && !settings) ||
            (body.permissions.returns?.includes("viewShop") && !shopReturns)
          ),
        }),
    },
  } as never);
  app.addHook("onRequest", (req, _reply, done) => {
    req.user = { id: "u1", role: "TECHNICIAN" } as never;
    done();
  });
  app.setErrorHandler((error, _req, reply) => {
    reply
      .status(isAppError(error) ? error.status : 500)
      .send({ code: isAppError(error) ? error.code : "INTERNAL_ERROR" });
  });
  app.register(tasksRoutes, { prefix: "/tasks" });
  app.register(workflowRoutes, { prefix: "/workflow" });
  app.register(purchaseOrdersRoutes, { prefix: "/purchase-orders" });
  return { app, prisma };
}
describe("multi-module workflow permissions", () => {
  it("checks supplier permissions even when the user can edit repairs", async () => {
    const { app, prisma } = buildApp({ manageCatalog: false });
    const result = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Call supplier",
        entityType: "SUPPLIER",
        entityId: "s1",
      },
    });
    expect(result.statusCode).toBe(403);
    expect(prisma.workshopTask.create).not.toHaveBeenCalled();
    await app.close();
  });
  it("creates a task attached to a supplier, without a repair", async () => {
    const { app, prisma } = buildApp();
    const result = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Call supplier",
        entityType: "SUPPLIER",
        entityId: "s1",
      },
    });
    expect(result.statusCode).toBe(201);
    expect(prisma.workshopTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "SUPPLIER",
        entityId: "s1",
        createdById: "u1",
      }),
    });
    await app.close();
  });
  it("filters dashboard tasks by module permissions and return self scope", async () => {
    const { app, prisma } = buildApp({ catalog: false, shopReturns: false });
    const result = await app.inject({ method: "GET", url: "/tasks" });
    expect(result.statusCode).toBe(200);
    const where = prisma.workshopTask.findMany.mock.calls[0]?.[0];
    expect(where).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: {
            in: ["GENERAL", "JOB", "REQUEST", "RETURN", "TRADE_IN", "CUSTOMER"],
          },
          OR: [
            { entityType: { not: "RETURN" } },
            { entityType: "RETURN", entityId: { in: ["visible-claim"] } },
          ],
        }),
      })
    );
    await app.close();
  });
  it("does not permit completion through a more permissive repair role", async () => {
    const { app } = buildApp({ manageCatalog: false });
    const result = await app.inject({
      method: "POST",
      url: "/tasks/t1/complete",
    });
    expect(result.statusCode).toBe(403);
    await app.close();
  });
  it("does not expose another technician's return through task context", async () => {
    const { app } = buildApp({ shopReturns: false });
    const result = await app.inject({
      method: "GET",
      url: "/tasks?entityType=RETURN&entityId=hidden-claim",
    });
    expect(result.statusCode).toBe(404);
    await app.close();
  });
  it("rejects a status from another module or a deactivated status", async () => {
    const { app, prisma } = buildApp();
    const result = await app.inject({
      method: "PUT",
      url: "/workflow",
      payload: {
        entityType: "SUPPLIER",
        entityId: "s1",
        stateId: "wrong-state",
      },
    });
    expect(result.statusCode).toBe(400);
    expect(prisma.recordWorkflow.upsert).not.toHaveBeenCalled();
    await app.close();
  });
  it("reserves status definitions for administrators", async () => {
    const { app, prisma } = buildApp({ settings: false });
    const result = await app.inject({
      method: "POST",
      url: "/workflow/states",
      payload: { entityType: "SUPPLIER", name: "Awaiting invoice" },
    });
    expect(result.statusCode).toBe(403);
    expect(prisma.workflowState.create).not.toHaveBeenCalled();
    await app.close();
  });
  it("returns validation errors for an empty status name", async () => {
    const { app } = buildApp();
    const result = await app.inject({
      method: "POST",
      url: "/workflow/states",
      payload: { entityType: "SUPPLIER", name: " " },
    });
    expect(result.statusCode).toBe(400);
    await app.close();
  });
  it("creates purchase orders only with a known supplier", async () => {
    const { app, prisma } = buildApp();
    prisma.supplier.findUnique.mockResolvedValueOnce(null as never);
    const result = await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: { title: "Screens", supplierId: "missing" },
    });
    expect(result.statusCode).toBe(404);
    expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    await app.close();
  });
});

it("allows an assigned technician to complete a supplier task without catalog management", async () => {
  const { app, prisma } = buildApp({ manageCatalog: false });
  prisma.workshopTask.findUnique.mockResolvedValue({
    entityType: "SUPPLIER",
    entityId: "s1",
    assigneeId: "u1",
    completedAt: new Date(),
  } as never);
  Object.assign(prisma, {
    $transaction: async (fn: (tx: unknown) => unknown) => await fn(prisma),
  });
  const result = await app.inject({
    method: "POST",
    url: "/tasks/t1/complete",
  });
  expect(result.statusCode).toBe(200);
  await app.close();
});

it("writes the tracking status and automatic task in one transaction", async () => {
  const { app, prisma } = buildApp();
  const record = { entityType: "SUPPLIER", entityId: "s1", stateId: "state1" };
  prisma.workflowState.findFirst.mockResolvedValue({ id: "state1" } as never);
  prisma.recordWorkflow.upsert.mockResolvedValue(record);
  prisma.taskRule.findMany.mockResolvedValue([
    {
      id: "rule1",
      title: "Await invoice",
      priority: "NORMAL",
      createdById: "u1",
      delayHours: 0,
      nextDelayHours: 0,
    },
  ] as never);
  const transaction = vi.fn(
    async (fn: (tx: unknown) => unknown) => await fn(prisma)
  );
  Object.assign(prisma, { $transaction: transaction });
  const result = await app.inject({
    method: "PUT",
    url: "/workflow",
    payload: record,
  });
  expect(result.statusCode).toBe(200);
  expect(transaction).toHaveBeenCalledOnce();
  expect(prisma.workshopTask.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { triggerKey: "rule1:SUPPLIER:s1" },
      create: expect.objectContaining({
        entityType: "SUPPLIER",
        entityId: "s1",
        title: "Await invoice",
      }),
    })
  );
  await app.close();
});

it("does not let an assignee without module editing permission edit task details", async () => {
  const { app } = buildApp({ manageCatalog: false });
  const result = await app.inject({
    method: "PATCH",
    url: "/tasks/t1",
    payload: { title: "Changed" },
  });
  expect(result.statusCode).toBe(403);
  await app.close();
});
it("rejects attempts to move an existing task through its edit endpoint", async () => {
  const { app } = buildApp();
  const result = await app.inject({
    method: "PATCH",
    url: "/tasks/t1",
    payload: { entityType: "JOB", entityId: "j1" },
  });
  expect(result.statusCode).toBe(400);
  await app.close();
});
