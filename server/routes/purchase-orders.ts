import { orderMargin } from "@shared/business-finance";
import { AppError } from "@shared/errors/app-error.js";
import { orderFields } from "@shared/schemas/business";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.js";
import { parseInput } from "../utils/parse-input.js";
import { getRole } from "../utils/request.js";

export const purchaseOrdersRoutes: FastifyPluginAsync = (app) => {
  app.addHook("preHandler", requirePermission({ parts: ["viewCatalog"] }));
  const serialize = async (
    req: FastifyRequest,
    order: Awaited<ReturnType<typeof app.prisma.purchaseOrder.findMany>>[number]
  ) => {
    const allowed = await app.auth.api.userHasPermission({
      body: { role: getRole(req), permissions: { parts: ["viewCost"] } },
    });
    const {
      costGross,
      quoteGross,
      costVatRate,
      saleVatRate,
      recoverInputVat,
      ...publicFields
    } = order;
    if (!allowed.success) {
      return publicFields;
    }
    const financials = {
      costGross: costGross.toString(),
      quoteGross: quoteGross.toString(),
      costVatRate: costVatRate.toString(),
      saleVatRate: saleVatRate.toString(),
      recoverInputVat,
    };
    return { ...publicFields, ...financials, margin: orderMargin(financials) };
  };
  app.get("/", async (req) => {
    const { cursor, supplierId, customerId, jobId, recordId } = parseInput(
      z.object({
        cursor: z.string().optional(),
        supplierId: z.string().optional(),
        customerId: z.string().optional(),
        jobId: z.string().optional(),
        recordId: z.string().optional(),
      }),
      req.query
    );
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
    const partyFilters = [
      ...(customer ? [{ customerId: customer }] : []),
      ...(vendor ? [{ supplierId: vendor }] : []),
    ];
    const data = await app.prisma.purchaseOrder.findMany({
      where: {
        jobId,
        id: recordId,
        ...(partyFilters.length ? { OR: partyFilters } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
        part: { select: { id: true, name: true } },
        job: { select: { id: true, jobCode: true } },
      },
      orderBy: { id: "desc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return {
      data: await Promise.all(data.map((order) => serialize(req, order))),
      nextCursor: data.length === 100 ? data.at(-1)?.id : null,
    };
  });
  const validateReferences = async (value: z.infer<typeof orderFields>) => {
    const refs = [
      value.supplierId
        ? app.prisma.supplier.findUnique({ where: { id: value.supplierId } })
        : true,
      value.customerId
        ? app.prisma.customer.findUnique({ where: { id: value.customerId } })
        : true,
      value.jobId
        ? app.prisma.job.findUnique({ where: { id: value.jobId } })
        : true,
      value.partId
        ? app.prisma.partsCatalog.findUnique({ where: { id: value.partId } })
        : true,
    ];
    if ((await Promise.all(refs)).some((value) => !value)) {
      throw new AppError("NOT_FOUND");
    }
    if (value.partId && value.kind !== "PART") {
      throw new AppError("VALIDATION_ERROR");
    }
  };
  app.post(
    "/",
    { preHandler: requirePermission({ parts: ["manageCatalog", "viewCost"] }) },
    async (req, reply) => {
      const data = parseInput(orderFields, req.body);
      await validateReferences(data);
      return reply.status(201).send({
        data: await serialize(
          req,
          await app.prisma.purchaseOrder.create({ data })
        ),
      });
    }
  );
  app.patch(
    "/:id",
    { preHandler: requirePermission({ parts: ["manageCatalog", "viewCost"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      const existing = await app.prisma.purchaseOrder.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new AppError("NOT_FOUND");
      }
      const parsed = parseInput(orderFields.partial(), req.body);
      // Zod applies defaults inside partial objects; retain only submitted keys.
      const patch = Object.fromEntries(
        Object.entries(parsed).filter(([key]) =>
          Object.hasOwn(req.body as object, key)
        )
      );
      const data = parseInput(orderFields, {
        ...existing,
        costGross: existing.costGross.toString(),
        quoteGross: existing.quoteGross.toString(),
        costVatRate: existing.costVatRate.toString(),
        saleVatRate: existing.saleVatRate.toString(),
        ...patch,
      });
      await validateReferences(data);
      return {
        data: await serialize(
          req,
          await app.prisma.purchaseOrder.update({ where: { id }, data })
        ),
      };
    }
  );
  return Promise.resolve();
};
