import type { PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import {
  closePartRequestSchema,
  createPartRequestSchema,
  partRequestReplySchema,
} from "@shared/schemas/part-request.schema";
import type { FastifyPluginAsync } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { requirePermission } from "../middlewares/rbac.js";
import { cloudFetch } from "../services/cloud.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const MODULE = "market";

interface CloudAuth {
  apiUrl: string;
  token: string;
}

/**
 * The procuro-peça board lives on the cloud (module "market") — the app is a
 * thin authenticated proxy so the shop token never reaches the browser.
 * Entitlement is checked against the locally cached list; the cloud still
 * enforces it server-side (its verdict wins if the cache is stale).
 */
async function requireMarket(prisma: PrismaClient): Promise<CloudAuth> {
  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  const modules = Array.isArray(settings.cloudEntitlements)
    ? (settings.cloudEntitlements as string[])
    : [];
  if (!modules.includes(MODULE)) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  return {
    apiUrl: settings.cloudApiUrl,
    token: decryptSecret(settings.cloudShopTokenEncrypted),
  };
}

async function proxy(
  auth: CloudAuth,
  path: string,
  init: { method?: string; body?: unknown } = {}
) {
  const res = await cloudFetch(auth.apiUrl, path, {
    ...init,
    token: auth.token,
  });
  if (!res.ok) {
    const code = (res.body as { error?: { code?: string } } | null)?.error
      ?.code;
    if (code === "MODULE_NOT_ENTITLED" || res.status === 402) {
      throw new AppError("CLOUD_MODULE_REQUIRED");
    }
    if (res.status === 404) {
      throw new AppError("PART_REQUEST_NOT_FOUND");
    }
    if (res.status === 403) {
      throw new AppError("FORBIDDEN");
    }
    if (res.status === 429) {
      throw new AppError("RATE_LIMITED");
    }
    throw new AppError("CLOUD_UNREACHABLE");
  }
  return res.body;
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const partRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        querystring: {
          properties: { scope: { type: "string" } },
          type: "object",
        },
        summary: "List board / own part requests",
        tags: ["part-requests"],
      },
    },
    async (req, reply) => {
      const auth = await requireMarket(app.prisma);
      const scope = (req.query as { scope?: string }).scope;
      const body = await proxy(
        auth,
        `/part-requests?scope=${scope === "mine" ? "mine" : "board"}`
      );
      return reply.send(body);
    }
  );

  app.post(
    "/",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: { summary: "Post a part request", tags: ["part-requests"] },
    },
    async (req, reply) => {
      const parsed = createPartRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const auth = await requireMarket(app.prisma);
      const body = await proxy(auth, "/part-requests", {
        body: parsed.data,
        method: "POST",
      });
      return reply.status(201).send(body);
    }
  );

  app.post(
    "/:id/close",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Mark own request found/closed",
        tags: ["part-requests"],
      },
    },
    async (req, reply) => {
      const parsed = closePartRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const { id } = req.params as { id: string };
      const auth = await requireMarket(app.prisma);
      const body = await proxy(auth, `/part-requests/${id}/close`, {
        body: parsed.data,
        method: "POST",
      });
      return reply.send(body);
    }
  );

  app.post(
    "/:id/replies",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Reply to another shop's request",
        tags: ["part-requests"],
      },
    },
    async (req, reply) => {
      const parsed = partRequestReplySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const { id } = req.params as { id: string };
      const auth = await requireMarket(app.prisma);
      const body = await proxy(auth, `/part-requests/${id}/replies`, {
        body: parsed.data,
        method: "POST",
      });
      return reply.status(201).send(body);
    }
  );

  app.get(
    "/:id/replies",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Replies to my request (contacts)",
        tags: ["part-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const auth = await requireMarket(app.prisma);
      const body = await proxy(auth, `/part-requests/${id}/replies`);
      return reply.send(body);
    }
  );
};
