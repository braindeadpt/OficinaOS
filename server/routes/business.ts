import type { Prisma } from "@generated/client";
import { commissionGross } from "@shared/business-finance";
import { AppError } from "@shared/errors/app-error.js";
import {
  agreementFields,
  messageFields,
  messageLink,
  ticketFields,
} from "@shared/schemas/business";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.js";
import { authorizeWorkflow } from "../services/workflow.service.js";
import { parseInput } from "../utils/parse-input.js";
import { getRole, getUserId } from "../utils/request.js";

const filterFields = z.object({
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  cursor: z.string().optional(),
  recordId: z.string().min(1).optional(),
});
const include = {
  customer: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
};
export const businessRoutes: FastifyPluginAsync = (app) => {
  const parties = async (value: {
    customerId?: string | null;
    supplierId?: string | null;
  }) => {
    if (
      value.customerId &&
      !(await app.prisma.customer.findUnique({
        where: { id: value.customerId },
      }))
    ) {
      throw new AppError("NOT_FOUND");
    }
    if (
      value.supplierId &&
      !(await app.prisma.supplier.findUnique({
        where: { id: value.supplierId },
      }))
    ) {
      throw new AppError("NOT_FOUND");
    }
  };
  // Both roles retain their existing IDs. Linking never merges or deletes history.
  app.get(
    "/parties",
    { preHandler: requirePermission({ jobs: ["view"] }) },
    async (req) => {
      const allowed = await app.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { parts: ["viewCatalog"] },
        },
      });
      const customers = await app.prisma.customer.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 1000,
      });
      const suppliers = allowed.success
        ? await app.prisma.supplier.findMany({
            select: { id: true, name: true, customerId: true },
            orderBy: { name: "asc" },
            take: 1000,
          })
        : [];
      return { customers, suppliers };
    }
  );
  app.put(
    "/identity/:supplierId",
    { preHandler: requirePermission({ settings: ["edit"] }) },
    async (req) => {
      const { supplierId } = parseInput(
        z.object({ supplierId: z.string().min(1) }),
        req.params
      );
      const { customerId } = parseInput(
        z.object({ customerId: z.string().min(1).nullable() }),
        req.body
      );
      await parties({ customerId, supplierId });
      if (
        customerId &&
        (await app.prisma.supplier.findFirst({
          where: { customerId, NOT: { id: supplierId } },
        }))
      ) {
        throw new AppError("VALIDATION_ERROR");
      }
      return {
        data: await app.prisma.supplier.update({
          where: { id: supplierId },
          data: { customerId },
          select: { id: true, customerId: true },
        }),
      };
    }
  );
  const whereParties = async (query: unknown) => {
    const { customerId, supplierId, cursor, recordId } = parseInput(
      filterFields,
      query
    );
    await parties({ customerId, supplierId });
    const linked = customerId
      ? await app.prisma.supplier.findUnique({
          where: { customerId },
          select: { id: true },
        })
      : null;
    const supplier = supplierId
      ? await app.prisma.supplier.findUnique({
          where: { id: supplierId },
          select: { customerId: true },
        })
      : null;
    const customer = customerId ?? supplier?.customerId;
    const vendor = supplierId ?? linked?.id;
    const OR = [
      ...(customer ? [{ customerId: customer }] : []),
      ...(vendor ? [{ supplierId: vendor }] : []),
    ];
    return {
      where: {
        ...(OR.length ? { OR } : {}),
        ...(recordId ? { id: recordId } : {}),
      },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 50,
      orderBy: { id: "desc" as const },
    };
  };
  app.get(
    "/tickets",
    { preHandler: requirePermission({ jobs: ["view"] }) },
    async (req) => {
      const data = await app.prisma.supportTicket.findMany({
        ...(await whereParties(req.query)),
        include,
      });
      return { data, nextCursor: data.length === 50 ? data.at(-1)?.id : null };
    }
  );
  app.post(
    "/tickets",
    { preHandler: requirePermission({ jobs: ["edit"] }) },
    async (req, reply) => {
      const data = parseInput(ticketFields, req.body);
      if (data.supplierId) {
        await authorizeWorkflow(req, "SUPPLIER", "view", data.supplierId);
      }
      await parties(data);
      return reply.status(201).send({
        data: await app.prisma.supportTicket.create({
          data: { ...data, createdById: getUserId(req) },
          include,
        }),
      });
    }
  );
  app.patch(
    "/tickets/:id",
    { preHandler: requirePermission({ jobs: ["edit"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      await authorizeWorkflow(req, "TICKET", "edit", id);
      const data = parseInput(ticketFields, req.body);
      if (data.supplierId) {
        await authorizeWorkflow(req, "SUPPLIER", "view", data.supplierId);
      }
      await parties(data);
      return {
        data: await app.prisma.supportTicket.update({
          where: { id },
          data,
          include,
        }),
      };
    }
  );
  // Unified capture is deliberately administrative until channel-specific access scopes exist.
  app.register((inbox) => {
    inbox.addHook("preHandler", requirePermission({ settings: ["edit"] }));
    inbox.get("/targets", async (req) => {
      const { entityType } = parseInput(
        z.object({
          entityType: z.enum([
            "JOB",
            "ORDER",
            "TICKET",
            "CUSTOMER",
            "SUPPLIER",
            "AGREEMENT",
          ]),
        }),
        req.query
      );
      switch (entityType) {
        case "JOB":
          return {
            data: (
              await app.prisma.job.findMany({
                select: { id: true, jobCode: true },
                orderBy: { id: "desc" },
                take: 1000,
              })
            ).map((row) => ({ id: row.id, name: row.jobCode })),
          };
        case "ORDER":
          return {
            data: (
              await app.prisma.purchaseOrder.findMany({
                select: { id: true, title: true },
                orderBy: { id: "desc" },
                take: 1000,
              })
            ).map((row) => ({ id: row.id, name: row.title })),
          };
        case "TICKET":
          return {
            data: (
              await app.prisma.supportTicket.findMany({
                select: { id: true, title: true, number: true },
                orderBy: { id: "desc" },
                take: 1000,
              })
            ).map((row) => ({
              id: row.id,
              name: `TK-${row.number} · ${row.title}`,
            })),
          };
        case "CUSTOMER":
          return {
            data: await app.prisma.customer.findMany({
              select: { id: true, name: true },
              orderBy: { name: "asc" },
              take: 1000,
            }),
          };
        case "SUPPLIER":
          return {
            data: await app.prisma.supplier.findMany({
              select: { id: true, name: true },
              orderBy: { name: "asc" },
              take: 1000,
            }),
          };
        case "AGREEMENT":
          return {
            data: (
              await app.prisma.commercialAgreement.findMany({
                select: { id: true, title: true },
                orderBy: { id: "desc" },
                take: 1000,
              })
            ).map((row) => ({ id: row.id, name: row.title })),
          };
        default:
          throw new AppError("VALIDATION_ERROR");
      }
    });
    inbox.get("/messages", async (req) => {
      const query = parseInput(
        filterFields.extend({
          entityType: messageLink.shape.entityType.optional(),
          entityId: z.string().optional(),
        }),
        req.query
      );
      const base = await whereParties(query);
      if (Boolean(query.entityType) !== Boolean(query.entityId)) {
        throw new AppError("VALIDATION_ERROR");
      }
      if (query.entityType && query.entityId) {
        await authorizeWorkflow(req, query.entityType, "view", query.entityId);
      }
      let where: Prisma.BusinessMessageWhereInput = base.where;
      if (base.where.OR?.length) {
        const customerIds = base.where.OR.flatMap((value) =>
          value.customerId ? [value.customerId] : []
        );
        const supplierIds = base.where.OR.flatMap((value) =>
          value.supplierId ? [value.supplierId] : []
        );
        const [jobs, orders, tickets] = await Promise.all([
          app.prisma.job.findMany({
            where: { customerId: { in: customerIds } },
            select: { id: true },
          }),
          app.prisma.purchaseOrder.findMany({
            where: { OR: base.where.OR },
            select: { id: true },
          }),
          app.prisma.supportTicket.findMany({
            where: { OR: base.where.OR },
            select: { id: true },
          }),
        ]);
        where = {
          ...base.where,
          OR: [
            ...base.where.OR,
            {
              links: {
                some: {
                  OR: [
                    { entityType: "CUSTOMER", entityId: { in: customerIds } },
                    { entityType: "SUPPLIER", entityId: { in: supplierIds } },
                    {
                      entityType: "JOB",
                      entityId: { in: jobs.map((value) => value.id) },
                    },
                    {
                      entityType: "ORDER",
                      entityId: { in: orders.map((value) => value.id) },
                    },
                    {
                      entityType: "TICKET",
                      entityId: { in: tickets.map((value) => value.id) },
                    },
                  ],
                },
              },
            },
          ],
        };
      }
      const data = await app.prisma.businessMessage.findMany({
        ...base,
        where: {
          ...where,
          ...(query.entityType
            ? {
                links: {
                  some: {
                    entityType: query.entityType,
                    entityId: query.entityId,
                  },
                },
              }
            : {}),
        },
        include: { ...include, links: true },
      });
      return {
        data,
        nextCursor: data.length === 50 ? data.at(-1)?.id : null,
        connectionStatus: "MANUAL_CAPTURE_ONLY",
      };
    });
    inbox.post("/messages", async (req, reply) => {
      const data = parseInput(messageFields, req.body);
      await parties(data);
      return reply.status(201).send({
        data: await app.prisma.businessMessage.create({
          data: { ...data, createdById: getUserId(req) },
          include: { ...include, links: true },
        }),
      });
    });
    inbox.patch("/messages/:id", async (req) => {
      const { id } = req.params as { id: string };
      await authorizeWorkflow(req, "MESSAGE", "edit", id);
      const data = parseInput(messageFields, req.body);
      await parties(data);
      return {
        data: await app.prisma.businessMessage.update({
          where: { id },
          data,
          include: { ...include, links: true },
        }),
      };
    });
    inbox.post("/messages/:id/links", async (req) => {
      const { id } = req.params as { id: string };
      await authorizeWorkflow(req, "MESSAGE", "edit", id);
      const data = parseInput(messageLink, req.body);
      await authorizeWorkflow(req, data.entityType, "edit", data.entityId);
      return {
        data: await app.prisma.businessMessageLink.upsert({
          where: { messageId_entityType_entityId: { messageId: id, ...data } },
          create: { messageId: id, ...data },
          update: {},
        }),
      };
    });
    inbox.delete("/messages/:id/links/:linkId", async (req, reply) => {
      const { id, linkId } = req.params as { id: string; linkId: string };
      await authorizeWorkflow(req, "MESSAGE", "edit", id);
      await app.prisma.businessMessageLink.deleteMany({
        where: { id: linkId, messageId: id },
      });
      return reply.status(204).send();
    });
    inbox.get("/agreements", async (req) => {
      const data = await app.prisma.commercialAgreement.findMany({
        ...(await whereParties(req.query)),
        include,
      });
      return { data, nextCursor: data.length === 50 ? data.at(-1)?.id : null };
    });
    const agreementData = (body: unknown) => {
      const data = parseInput(agreementFields, body);
      return {
        ...data,
        amountGross:
          data.kind === "COMMISSION"
            ? commissionGross(
                data.commissionBasisNet,
                data.commissionRate,
                data.vatRate
              )
            : data.amountGross,
      };
    };
    inbox.post("/agreements", async (req, reply) => {
      const data = agreementData(req.body);
      await parties(data);
      return reply.status(201).send({
        data: await app.prisma.commercialAgreement.create({ data, include }),
      });
    });
    inbox.patch("/agreements/:id", async (req) => {
      const { id } = req.params as { id: string };
      await authorizeWorkflow(req, "AGREEMENT", "edit", id);
      const data = agreementData(req.body);
      await parties(data);
      return {
        data: await app.prisma.commercialAgreement.update({
          where: { id },
          data,
          include,
        }),
      };
    });
    return Promise.resolve();
  });
  return Promise.resolve();
};
