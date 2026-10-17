import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requirePermission } from "../middlewares/rbac.js";
import { parseInput } from "../utils/parse-input.js";

const fields = z.object({
  title: z.string().trim().min(1).max(200),
  supplierId: z.string().min(1).nullable().optional(),
  notes: z.string().max(8000).optional(),
  reference: z.string().max(100).optional(),
});
export const purchaseOrdersRoutes: FastifyPluginAsync = (app) => {
  app.addHook("preHandler", requirePermission({ parts: ["viewCatalog"] }));
  app.get("/", async (req) => {
    const { cursor, supplierId } = parseInput(
      z.object({
        cursor: z.string().optional(),
        supplierId: z.string().optional(),
      }),
      req.query
    );
    const data = await app.prisma.purchaseOrder.findMany({
      where: { supplierId },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { id: "desc" },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return { data, nextCursor: data.length === 100 ? data.at(-1)?.id : null };
  });
  const validateSupplier = async (supplierId?: string | null) => {
    if (
      supplierId &&
      !(await app.prisma.supplier.findUnique({ where: { id: supplierId } }))
    ) {
      throw new AppError("NOT_FOUND");
    }
  };
  app.post(
    "/",
    { preHandler: requirePermission({ parts: ["manageCatalog"] }) },
    async (req, reply) => {
      const data = parseInput(fields, req.body);
      await validateSupplier(data.supplierId);
      return reply
        .status(201)
        .send({ data: await app.prisma.purchaseOrder.create({ data }) });
    }
  );
  app.patch(
    "/:id",
    { preHandler: requirePermission({ parts: ["manageCatalog"] }) },
    async (req) => {
      const { id } = req.params as { id: string };
      const data = parseInput(fields.partial(), req.body);
      await validateSupplier(data.supplierId);
      return {
        data: await app.prisma.purchaseOrder.update({ where: { id }, data }),
      };
    }
  );
  return Promise.resolve();
};
