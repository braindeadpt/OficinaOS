import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginCallback } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import { isModuleEnabled } from "../utils/modules.js";
import { tryRegisterEvolutionWebhook } from "./settings.js";

const MODULE = "ponto";

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
      preHandler: [requirePermission({ settings: ["view"] })],
      schema: {
        summary: "Whether the ponto (time clock) Pro module is enabled",
        tags: ["ponto"],
      },
    },
    async (_req, reply) => {
      const settings = await getOrCreateShopSettings(app.prisma);
      return reply.send({ enabled: isModuleEnabled(settings, MODULE) });
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

  done();
};
