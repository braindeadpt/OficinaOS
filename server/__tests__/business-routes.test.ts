import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { businessRoutes } from "../routes/business.js";
import { purchaseOrdersRoutes } from "../routes/purchase-orders.js";

function build({ admin = true, cost = true } = {}) {
  const order = {
    id: "o1",
    title: "Parts",
    kind: "PART",
    costGross: "123",
    quoteGross: "246",
    costVatRate: "23",
    saleVatRate: "23",
    recoverInputVat: true,
  };
  const prisma = {
    customer: {
      findUnique: vi.fn(async () => ({ id: "c1" })),
      findMany: vi.fn(async () => []),
    },
    supplier: {
      findUnique: vi.fn(async () => ({ id: "s1", customerId: "c1" })),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }) => data),
    },
    job: {
      findUnique: vi.fn(async () => ({ id: "j1" })),
      findMany: vi.fn(async () => [{ id: "j1" }]),
    },
    partsCatalog: { findUnique: vi.fn(async () => ({ id: "p1" })) },
    supportTicket: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({ id: "t1" })),
      create: vi.fn(async ({ data }) => ({ id: "t1", ...data })),
    },
    businessMessage: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({ id: "m1" })),
      create: vi.fn(async ({ data }) => ({ id: "m1", ...data })),
    },
    businessMessageLink: {
      upsert: vi.fn(async ({ create }) => create),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    commercialAgreement: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }) => ({ id: "a1", ...data })),
    },
    purchaseOrder: {
      findMany: vi.fn(async () => [order]),
      findUnique: vi.fn(async () => order),
      update: vi.fn(async ({ data }) => ({ ...order, ...data })),
    },
  };
  const app = Fastify();
  app.decorate("prisma", prisma as never);
  app.decorate("auth", {
    api: {
      userHasPermission: ({
        body,
      }: {
        body: { permissions: { settings?: string[]; parts?: string[] } };
      }) =>
        Promise.resolve({
          success: !(
            (body.permissions.settings && !admin) ||
            (body.permissions.parts?.includes("viewCost") && !cost)
          ),
        }),
    },
  } as never);
  app.addHook("onRequest", (req, _reply, done) => {
    req.user = { id: "u1", role: admin ? "OWNER" : "TECHNICIAN" } as never;
    done();
  });
  app.setErrorHandler((error, _req, reply) =>
    reply
      .status(isAppError(error) ? error.status : 500)
      .send({ code: isAppError(error) ? error.code : "INTERNAL_ERROR" })
  );
  app.register(businessRoutes, { prefix: "/business" });
  app.register(purchaseOrdersRoutes, { prefix: "/purchase-orders" });
  return { app, prisma };
}
describe("business authorization and linkage", () => {
  it("restricts messages, commercial data and identity editing to administrators", async () => {
    const { app } = build({ admin: false });
    for (const url of [
      "/business/messages",
      "/business/agreements",
      "/business/targets?entityType=JOB",
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/business/identity/s1",
          payload: { customerId: "c1" },
        })
      ).statusCode
    ).toBe(403);
    await app.close();
  });
  it("preserves shared customer and supplier history in ticket queries", async () => {
    const { app, prisma } = build();
    expect(
      (await app.inject({ url: "/business/tickets?customerId=c1" })).statusCode
    ).toBe(200);
    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ customerId: "c1" }, { supplierId: "s1" }] },
      })
    );
    await app.close();
  });
  it("includes messages linked to a customer's repairs, orders and tickets in the shared history", async () => {
    const { app, prisma } = build();
    expect(
      (await app.inject({ url: "/business/messages?customerId=c1" })).statusCode
    ).toBe(200);
    expect(prisma.businessMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { customerId: "c1" },
            { supplierId: "s1" },
            {
              links: {
                some: {
                  OR: expect.arrayContaining([
                    { entityType: "JOB", entityId: { in: ["j1"] } },
                    { entityType: "ORDER", entityId: { in: ["o1"] } },
                  ]),
                },
              },
            },
          ]),
        }),
      })
    );
    await app.close();
  });
  it("shows customer orders in the history of the same entity's supplier role", async () => {
    const { app, prisma } = build();
    expect(
      (await app.inject({ url: "/purchase-orders?supplierId=s1" })).statusCode
    ).toBe(200);
    expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ customerId: "c1" }, { supplierId: "s1" }],
        }),
      })
    );
    await app.close();
  });
  it("does not overwrite an identity already linked to another supplier", async () => {
    const { app, prisma } = build();
    prisma.supplier.findFirst.mockResolvedValue({ id: "other" } as never);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/business/identity/s1",
          payload: { customerId: "c1" },
        })
      ).statusCode
    ).toBe(400);
    expect(prisma.supplier.update).not.toHaveBeenCalled();
    await app.close();
  });
  it("rejects nonexistent linked records before writing a message link", async () => {
    const { app, prisma } = build();
    prisma.job.findUnique.mockResolvedValue(null as never);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/business/messages/m1/links",
          payload: { entityType: "JOB", entityId: "missing" },
        })
      ).statusCode
    ).toBe(404);
    expect(prisma.businessMessageLink.upsert).not.toHaveBeenCalled();
    await app.close();
  });
  it("adds a repair link idempotently", async () => {
    const { app, prisma } = build();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/business/messages/m1/links",
          payload: { entityType: "JOB", entityId: "j1" },
        })
      ).statusCode
    ).toBe(200);
    expect(prisma.businessMessageLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageId_entityType_entityId: {
            messageId: "m1",
            entityType: "JOB",
            entityId: "j1",
          },
        },
      })
    );
    await app.close();
  });
  it("calculates commission server-side rather than trusting the submitted total", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "POST",
      url: "/business/agreements",
      payload: {
        kind: "COMMISSION",
        title: "Referral",
        amountGross: "999",
        vatRate: "23",
        commissionBasisNet: "1000",
        commissionRate: "10",
        paidGross: "0",
        interval: "ONCE",
        status: "ACTIVE",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data.amountGross).toBe("123.00");
    await app.close();
  });
  it("never exposes order costs and margins without viewCost", async () => {
    const { app } = build({ admin: false, cost: false });
    const response = await app.inject({ url: "/purchase-orders" });
    expect(response.statusCode).toBe(200);
    const data = response.json().data[0];
    expect(data).not.toHaveProperty("costGross");
    expect(data).not.toHaveProperty("quoteGross");
    expect(data).not.toHaveProperty("margin");
    await app.close();
  });
  it("preserves existing financial values on a title-only edit", async () => {
    const { app, prisma } = build();
    const response = await app.inject({
      method: "PATCH",
      url: "/purchase-orders/o1",
      payload: { title: "New title" },
    });
    expect(response.statusCode).toBe(200);
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "New title",
          costGross: "123",
          kind: "PART",
        }),
      })
    );
    await app.close();
  });
});
