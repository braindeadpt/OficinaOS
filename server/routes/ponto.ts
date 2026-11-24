import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  pontoEntriesQuerySchema,
  pontoEntryIdParamSchema,
  pontoHoursQuerySchema,
  pontoManualEntrySchema,
  pontoMissingExitsQuerySchema,
  pontoValidateSchema,
} from "@shared/schemas/ponto.schema.js";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { loadEnv } from "../config/env.js";
import { decryptSecret } from "../lib/crypto.js";
import { dashboardScope } from "../middlewares/dashboard-scope.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import {
  createManualEntry,
  createValidation,
  getHours,
  getMissingExits,
  listEntries,
  listNow,
  listPending,
  resolvePontoPhotoPath,
  resolvePontoRange,
} from "../services/ponto-panel.service.js";
import { isModuleEnabled } from "../utils/modules.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const MODULE = "ponto";

/**
 * Fuso da loja garantido pelo middleware dashboardScope (preHandler das
 * rotas de leitura). Se estiver ausente é erro de wiring da rota, não de
 * pedido — falha alto em vez de assumir UTC e agrupar dias ao lado.
 */
function shopTz(req: FastifyRequest): string {
  const scope = req.dashboardScope;
  if (!scope) {
    throw new AppError("INTERNAL_ERROR");
  }
  return scope.shopTz;
}

interface PontoAuth {
  apiUrl: string;
  settings: {
    pontoSmsNumber: string | null;
    pontoWaNumber: string | null;
  };
  token: string;
}

/**
 * Livro de ponto (Pro module "ponto"): a app é um proxy fino para a Cloud —
 * os números de WhatsApp/SMS que o QR divulga vivem nas settings locais e
 * são empurrados com PUT /ponto/config; a leitura (slug/config) vem da
 * Cloud, que pode ainda não estar deployada — falhas degradam para
 * {configured:false} em vez de erro.
 */
async function requirePonto(prisma: PrismaClient): Promise<PontoAuth> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  if (!isModuleEnabled(settings, MODULE)) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  return {
    apiUrl: settings.cloudApiUrl,
    settings: {
      pontoSmsNumber: settings.pontoSmsNumber,
      pontoWaNumber: settings.pontoWaNumber,
    },
    token: decryptSecret(settings.cloudShopTokenEncrypted),
  };
}

// Registo síncrono — a variante callback evita o async sem await.
export const pontoRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get(
    "/status",
    {
      // dashboardScope resolve o fuso efetivo da loja (ShopSettings.timezone
      // com fallback env TZ) — a UI formata horas no mesmo fuso do servidor
      // em vez de adivinhar pelo relógio do dispositivo.
      preHandler: [requirePermission({ settings: ["view"] }), dashboardScope],
      schema: {
        summary: "Whether the ponto (time clock) Pro module is enabled",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const settings = await getOrCreateShopSettings(app.prisma);
      return reply.send({
        enabled: isModuleEnabled(settings, MODULE),
        tz: shopTz(req),
      });
    }
  );

  app.get(
    "/config",
    {
      preHandler: [requirePermission({ settings: ["view"] })],
      schema: {
        summary: "Ponto QR config held by the cloud (slug + displayed numbers)",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => {
      const { apiUrl, token } = await requirePonto(app.prisma);
      const res = await cloudFetch(apiUrl, "/ponto/config", { token }).catch(
        () => null
      );
      // A Cloud do item paralelo pode ainda não estar deployada — qualquer
      // falha (rede, 404, 5xx) degrada para configured:false.
      if (!res?.ok) {
        return reply.send({ configured: false });
      }
      const body = res.body as Record<string, unknown> | null;
      if (!body || typeof body !== "object") {
        return reply.send({ configured: false });
      }
      return reply.send(body);
    }
  );

  app.put(
    "/config",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        summary: "Push the local ponto WhatsApp/SMS numbers to the cloud",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => {
      const { apiUrl, settings, token } = await requirePonto(app.prisma);
      const res = await cloudFetch(apiUrl, "/ponto/config", {
        body: {
          smsNumber: settings.pontoSmsNumber,
          waNumber: settings.pontoWaNumber,
        },
        method: "PUT",
        token,
      }).catch(() => null);
      if (!res) {
        throw new AppError("CLOUD_UNREACHABLE");
      }
      if (res.status === 402) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
      if (!res.ok) {
        throw new AppError("CLOUD_REQUEST_FAILED");
      }
      return reply.send(
        res.body && typeof res.body === "object" ? res.body : { ok: true }
      );
    }
  );

  // ── Painel "Livro de Ponto" (item 4) ──────────────────────────────────
  //
  // Permissões: leituras de dados laborais seguem a família reports
  // (viewShop — só OWNER); escritas/validação seguem a gestão de staff
  // (user:update — só OWNER na matriz atual). Sem gate de módulo: os
  // registos são dados laborais com retenção legal de 5 anos — o painel
  // continua consultável/acessível mesmo se o entitlement cair; a UI é
  // que esconde a entrada de menu.

  app.get(
    "/now",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        summary: "Who is clocked in right now (shop-local today)",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const tz = shopTz(req);
      return reply.send(await listNow(app.prisma, tz));
    }
  );

  app.get(
    "/entries",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        querystring: { type: "object", additionalProperties: true },
        summary: "Time entries in a shop-local date range",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const parsed = pontoEntriesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const tz = shopTz(req);
      const range = resolvePontoRange(parsed.data.from, parsed.data.to, tz);
      return reply.send(
        await listEntries(app.prisma, range, {
          limit: parsed.data.limit,
          offset: parsed.data.offset,
          status: parsed.data.status,
          userId: parsed.data.userId,
        })
      );
    }
  );

  app.get(
    "/pending",
    {
      preHandler: [requirePermission({ reports: ["viewShop"] })],
      schema: {
        summary: "Entries still waiting for a human decision",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => reply.send(await listPending(app.prisma))
  );

  app.post(
    "/entries/:id/validate",
    {
      preHandler: [requirePermission({ user: ["update"] })],
      schema: {
        body: { type: "object", additionalProperties: true },
        params: { type: "object", additionalProperties: true },
        summary: "Approve or reject a pending time entry (append-only)",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const params = pontoEntryIdParamSchema.safeParse(req.params);
      if (!params.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            params.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const body = pontoValidateSchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            body.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const validation = await createValidation(
        app.prisma,
        params.data.id,
        getUserId(req),
        body.data.decision,
        body.data.note
      );
      return reply.send({
        effectiveStatus: body.data.decision,
        validation: {
          ...validation,
          at: validation.at.toISOString(),
          byUserName:
            validation.byUser.name || validation.byUser.username || null,
        },
      });
    }
  );

  app.post(
    "/entries",
    {
      preHandler: [requirePermission({ user: ["update"] })],
      schema: {
        body: { type: "object", additionalProperties: true },
        summary: "Register a manual time entry (forgotten clock-out, fix)",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const body = pontoManualEntrySchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            body.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await createManualEntry(
        app.prisma,
        getUserId(req),
        body.data
      );
      return reply.status(201).send(result);
    }
  );

  app.get(
    "/hours",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        querystring: { type: "object", additionalProperties: true },
        summary: "Worked minutes per user per shop-local day",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const parsed = pontoHoursQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const tz = shopTz(req);
      const range = resolvePontoRange(parsed.data.from, parsed.data.to, tz);
      return reply.send(
        await getHours(app.prisma, tz, range, parsed.data.userId)
      );
    }
  );

  app.get(
    "/missing-exits",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        querystring: { type: "object", additionalProperties: true },
        summary: "Days whose last effective event is not a clock-out",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const parsed = pontoMissingExitsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const tz = shopTz(req);
      const range = resolvePontoRange(parsed.data.from, parsed.data.to, tz);
      return reply.send(await getMissingExits(app.prisma, tz, range));
    }
  );

  // Geo da loja para o mapa esquemático do painel "Por validar" — dados
  // locais (ShopSettings), não dependem da Cloud.
  app.get(
    "/geo",
    {
      preHandler: [requirePermission({ reports: ["viewShop"] })],
      schema: {
        summary: "Shop geo center + acceptance radius for the pending map",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => {
      const settings = await getOrCreateShopSettings(app.prisma);
      return reply.send({
        lat: settings.pontoGeoLat,
        lng: settings.pontoGeoLng,
        radiusM: settings.pontoRadiusM,
      });
    }
  );

  // Fotos de prova: acesso por id (não por path) — a URL nunca expõe a
  // estrutura de diretórios e o guard de traversal impede escapes de
  // UPLOAD_DIR mesmo que um path gravado seja adulterado.
  const PHOTO_MIME: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };

  app.get(
    "/photos/:photoId",
    {
      preHandler: [requirePermission({ reports: ["viewShop"] })],
      schema: {
        params: { type: "object", additionalProperties: true },
        summary: "Serve a ponto proof photo by id",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const { photoId } = req.params as { photoId: string };
      const photo = await app.prisma.pontoPhoto.findUnique({
        select: { path: true },
        where: { id: photoId },
      });
      if (!photo) {
        throw new AppError("NOT_FOUND");
      }
      const full = resolvePontoPhotoPath(loadEnv().UPLOAD_DIR, photo.path);
      if (!full) {
        throw new AppError("NOT_FOUND");
      }
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat?.isFile()) {
        throw new AppError("NOT_FOUND");
      }
      const type =
        PHOTO_MIME[path.extname(full).toLowerCase()] ??
        "application/octet-stream";
      return reply.type(type).send(fs.createReadStream(full));
    }
  );

  done();
};
