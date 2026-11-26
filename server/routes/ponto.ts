import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  pontoActExportQuerySchema,
  pontoEntriesQuerySchema,
  pontoEntryIdParamSchema,
  pontoHoursQuerySchema,
  pontoInfoDeliveryUpsertSchema,
  pontoManualEntrySchema,
  pontoMissingExitsQuerySchema,
  pontoValidateSchema,
} from "@shared/schemas/ponto.schema.js";
import type { FastifyPluginCallback, FastifyRequest } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { dashboardScope } from "../middlewares/dashboard-scope.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import { pushPontoCloudConfig } from "../services/ponto/config-sync.js";
import { getPontoActExport } from "../services/ponto-act-export.service.js";
import {
  listPontoInfoDeliveries,
  upsertPontoInfoDelivery,
} from "../services/ponto-info.service.js";
import {
  createManualEntry,
  createValidation,
  getHours,
  getMissingExits,
  listEntries,
  listNow,
  listPending,
  listRecentDecisions,
  resolvePontoRange,
} from "../services/ponto-panel.service.js";
import { isModuleEnabled } from "../utils/modules.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";
import { tryRegisterEvolutionWebhook } from "./settings.js";

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

/**
 * Gate das escritas do painel (criar/validar/corrigir): exigem o módulo
 * `ponto` ativo. As leituras e a exportação ficam propositadamente fora
 * deste gate — retenção legal de 5 anos mesmo depois de a subscrição
 * cair (decisão WP0.5, 2026-11-25).
 */
async function requirePontoModule(prisma: PrismaClient): Promise<void> {
  const settings = await getOrCreateShopSettings(prisma);
  if (!isModuleEnabled(settings, MODULE)) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
}

// Registo síncrono — a variante callback evita o async sem await.
export const pontoRoutes: FastifyPluginCallback = (app, _opts, done) => {
  app.get(
    "/mode",
    {
      schema: {
        summary:
          "Instance mode for every authenticated user (no settings data)",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => {
      const settings = await getOrCreateShopSettings(app.prisma);
      return reply.send({ shopMode: settings.shopMode ?? "repair_shop" });
    }
  );

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
      // Falhas da limpeza das fotografias antigas. Fonte principal: as
      // linhas que continuam em ponto_photos — a linha só é apagada
      // quando TODAS as cópias do ficheiro desaparecem, por isso cada
      // linha presente É uma fotografia por apagar. E sobrevive a
      // reversões do atualizador, que não restaura a base de dados.
      // O relatório em UPLOAD_DIR/ponto-photo-shred.json cobre órfãos
      // e pastas que não se conseguiram listar.
      const photoCleanupWarnings: string[] = [];
      try {
        const reg = await app.prisma.$queryRaw<{ reg: string | null }[]>`
          SELECT to_regclass('public.ponto_photos')::text AS reg`;
        if (reg[0]?.reg) {
          const rows = await app.prisma.$queryRaw<{ path: string }[]>`
            SELECT path FROM "ponto_photos"`;
          for (const row of rows) {
            photoCleanupWarnings.push(row.path);
          }
        }
      } catch {
        // Sem tabela (limpeza concluída) ou BD indisponível — o
        // relatório ainda pode ter entradas.
      }
      try {
        const reportPath = path.resolve(
          process.env.UPLOAD_DIR ?? "./uploads",
          "ponto-photo-shred.json"
        );
        const raw = await fs.readFile(reportPath, "utf-8");
        const parsed = JSON.parse(raw) as { failures?: unknown };
        if (Array.isArray(parsed.failures)) {
          const listed = parsed.failures.filter(
            (f): f is string => typeof f === "string"
          );
          // Pastas já apagadas à mão saem do aviso — sem isto o relatório
          // era lido para sempre e o aviso nunca desaparecia. Entradas com
          // padrões (app.prev*) não são caminhos reais: ficam sempre.
          // Caminhos UNC/rede são recusados ANTES de qualquer stat: o
          // relatório pode ser alterado por utilizadores locais e um
          // caminho \\host\partilha levaria o Windows a autenticação SMB
          // num destino não autorizado.
          const stillThere = await Promise.all(
            listed.map(async (f) => {
              if (f.includes("*")) {
                return f;
              }
              if (
                f.startsWith("\\\\") ||
                f.startsWith("//") ||
                !path.isAbsolute(f)
              ) {
                return null;
              }
              const stat = await fs.stat(f).catch(() => null);
              return stat ? f : null;
            })
          );
          photoCleanupWarnings.push(
            ...stillThere.filter((f): f is string => f !== null)
          );
        }
      } catch {
        // Sem relatório — as linhas da BD já estão no aviso.
      }
      // Acesso legal à exportação ACT: mesmo com o entitlement terminado,
      // existindo registos os menus têm de continuar a mostrar o destino
      // (retenção/consulta de 5 anos). `hasRecords` é o sinal barato.
      const firstEntry = await app.prisma.timeEntry.findFirst({
        select: { id: true },
      });
      return reply.send({
        enabled: isModuleEnabled(settings, MODULE),
        photoCleanupWarnings,
        hasRecords: firstEntry !== null,
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
    async (req, reply) => {
      await requirePonto(app.prisma);
      const res = await pushPontoCloudConfig(app.prisma, req.log);
      if (!res) {
        throw new AppError("CLOUD_UNREACHABLE");
      }
      if (res.status === 402) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
      if (!res.ok) {
        throw new AppError("CLOUD_REQUEST_FAILED");
      }
      // Ativação do ponto é o momento em que o webhook Evolution tem de
      // existir: se o módulo chegou depois da última gravação de
      // definições WhatsApp (e sem termo do bot aceite), a instância
      // ainda não tem callback — sem ele as marcações nunca chegam.
      // O Host do pedido é o endereço que a Evolution alcança.
      await tryRegisterEvolutionWebhook(
        app.prisma,
        req.headers.host ?? ""
      ).catch((err) =>
        req.log.warn({ err }, "evolution webhook register failed")
      );
      return reply.send(
        res.body && typeof res.body === "object" ? res.body : { ok: true }
      );
    }
  );

  app.post(
    "/regenerate-qr",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: {
        summary:
          "Regenerate the ponto QR id in the cloud (invalidates printed QRs)",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => {
      const { apiUrl, token } = await requirePonto(app.prisma);
      const res = await cloudFetch(apiUrl, "/ponto/regenerate-qr", {
        method: "POST",
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
  // (user:update — só OWNER na matriz atual). Leituras sem gate de
  // módulo: os registos são dados laborais com retenção legal de 5 anos
  // e continuam consultáveis/exportáveis mesmo se o entitlement cair.
  // As escritas (validate/manual) exigem o módulo — ver requirePontoModule.

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
    "/decided",
    {
      preHandler: [requirePermission({ reports: ["viewShop"] })],
      schema: {
        summary:
          "Entries decided in the last 7 days (decisions are reversible)",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => reply.send(await listRecentDecisions(app.prisma))
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
      await requirePontoModule(app.prisma);
      const validation = await createValidation(
        app.prisma,
        params.data.id,
        getUserId(req),
        body.data.decision,
        body.data.note
      );
      // Aprovar/recusar muda o estado efetivo que a Cloud usa para a
      // sequência do dia; na recusa de uma ENTRADA o payload calculado pelo
      // config-sync inclui revokeEntryAt. Best-effort e fora da resposta:
      // a decisão local é legalmente válida mesmo com a Cloud em baixo.
      pushPontoCloudConfig(app.prisma, req.log).catch(() => null);
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
      await requirePontoModule(app.prisma);
      const result = await createManualEntry(
        app.prisma,
        getUserId(req),
        body.data
      );
      // Entradas manuais/correções mudam o estado que a Cloud usa para
      // validar pausas/saídas. Best-effort e fora da resposta: uma Cloud
      // em baixo não pode impedir o livro legal local.
      pushPontoCloudConfig(app.prisma, req.log).catch(() => null);
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

  // Exportação ACT: deliberadamente fora de requirePonto/requirePontoModule
  // e sem qualquer chamada à Cloud — consulta legal imediata mesmo offline
  // ou depois do entitlement terminar.
  app.get(
    "/act-export",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        querystring: { type: "object", additionalProperties: true },
        summary: "Canonical local dataset for the ACT time-record export",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const parsed = pontoActExportQuerySchema.safeParse(req.query);
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
        await getPontoActExport(app.prisma, {
          actorId: getUserId(req),
          range,
          tz,
          userId: parsed.data.userId,
        })
      );
    }
  );

  app.get(
    "/info-deliveries",
    {
      preHandler: [
        requirePermission({ reports: ["viewShop"] }),
        dashboardScope,
      ],
      schema: {
        summary: "Delivery status of the worker RGPD information sheet",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => reply.send(await listPontoInfoDeliveries(app.prisma))
  );

  app.put(
    "/info-deliveries/:userId",
    {
      preHandler: [requirePermission({ user: ["update"] }), dashboardScope],
      schema: {
        summary: "Register delivery/signature of the worker information sheet",
        tags: ["ponto"],
      },
    },
    async (req, reply) => {
      const parsed = pontoInfoDeliveryUpsertSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const { userId } = req.params as { userId: string };
      await requirePontoModule(app.prisma);
      return reply.send(
        await upsertPontoInfoDelivery(app.prisma, {
          actorId: getUserId(req),
          deliveredAt: parsed.data.deliveredAt,
          signed: parsed.data.signed,
          userId,
        })
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

  done();
};
