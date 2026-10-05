import { AppError } from "@shared/errors/app-error.js";
import {
  createSaleSchema,
  listSalesQuerySchema,
} from "@shared/schemas/sale.schema";
import type { FastifyPluginAsync } from "fastify";
import { resolveUrls } from "../config/env.js";
import { requirePermission } from "../middlewares/rbac.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import {
  buildSaleReceiptEscPos,
  sendEscPos,
} from "../services/escpos.service.js";
import { issueInvoiceForSale } from "../services/invoicing.service.js";
import { renderSaleReceiptHtml } from "../services/receipt.service.js";
import {
  create as createSale,
  getById as getSaleById,
  list as listSales,
} from "../services/sale.service.js";
import { getRole, getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const saleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ sales: ["view"] }));

  app.get(
    "/",
    {
      schema: {
        tags: ["sales"],
        summary: "List counter sales",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = listSalesQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await listSales(app.prisma, parsed.data);
      return reply.send(result);
    }
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["sales"],
        summary: "Create a counter sale (POS checkout)",
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ sales: ["create"] })],
    },
    async (req, reply) => {
      const parsed = createSaleSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const pricePerm = await app.auth.api.userHasPermission({
        body: {
          role: getRole(req),
          permissions: { parts: ["overridePrice"] },
        },
      });
      const sale = await createSale(app.prisma, app, parsed.data, userId, {
        canOverridePrice: Boolean(pricePerm.success),
      });
      return reply.status(201).send(sale);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["sales"],
        summary: "Get a counter sale by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sale = await getSaleById(app.prisma, id);
      if (!sale) {
        throw new AppError("SALE_NOT_FOUND");
      }
      return reply.send(sale);
    }
  );

  app.get(
    "/:id/receipt",
    {
      schema: {
        tags: ["sales"],
        summary: "Get POS sale receipt HTML",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sale = await getSaleById(app.prisma, id);
      if (!sale) {
        throw new AppError("SALE_NOT_FOUND");
      }

      const { appUrl: baseUrl } = resolveUrls();
      if (!baseUrl) {
        app.log.warn("APP_URL is not set — sale receipt QR will not work");
      }

      const html = await renderSaleReceiptHtml(
        app.prisma,
        sale as unknown as Parameters<typeof renderSaleReceiptHtml>[1],
        baseUrl,
        { locale: req.locale }
      );

      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .send(html);
    }
  );

  app.post(
    "/:id/invoice",
    {
      schema: {
        tags: ["sales"],
        summary:
          "Issue the fiscal document (InvoiceXpress) for a completed sale",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ sales: ["create"] })],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const issued = await issueInvoiceForSale(app.prisma, id, app.log);
      return reply.status(201).send(issued);
    }
  );

  app.post(
    "/:id/print-receipt",
    {
      schema: {
        tags: ["sales"],
        summary: "Print sale receipt on the configured ESC/POS network printer",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const sale = await getSaleById(app.prisma, id);
      if (!sale) {
        throw new AppError("SALE_NOT_FOUND");
      }
      const settings = await findShopSettingsUnique(app.prisma);
      const data = buildSaleReceiptEscPos(
        settings,
        sale as unknown as Parameters<typeof buildSaleReceiptEscPos>[1],
        { locale: req.locale }
      );
      await sendEscPos(settings, data);
      return reply.send({ ok: true });
    }
  );
};
