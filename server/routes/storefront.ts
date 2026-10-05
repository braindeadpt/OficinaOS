import { AppError } from "@shared/errors/app-error.js";
import { updateStorefrontSchema } from "@shared/schemas/storefront.schema";
import type { FastifyPluginAsync } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { requirePermission } from "../middlewares/rbac.js";
import {
  pushStorefront,
  storefrontUrl,
} from "../services/storefront.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const MODULE = "storefront";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const storefrontRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Loja online (módulo Pro "storefront"): a config local vive em
   * shop_settings; a cloud é a fonte da verdade para o slug público.
   * O token da loja nunca chega ao browser — os pushes saem daqui.
   */

  app.get(
    "/",
    {
      preHandler: [requirePermission({ settings: ["view"] })],
      schema: { summary: "Online store config + status", tags: ["storefront"] },
    },
    async (_req, reply) => {
      const s = await app.prisma.shopSettings.findUniqueOrThrow({
        where: { id: "default" },
      });
      const modules = Array.isArray(s.cloudEntitlements)
        ? (s.cloudEntitlements as string[])
        : [];
      const itemCount = await app.prisma.partsCatalog.count({
        where: { listedOnline: true, isActive: true },
      });
      return reply.send({
        dirty: s.storeDirty,
        email: s.storeEmail,
        description: s.storeDescription,
        itemCount,
        module: modules.includes(MODULE),
        paired: Boolean(s.cloudShopTokenEncrypted),
        published: s.storePublished,
        slug: s.storeSlug,
        url:
          s.cloudApiUrl && s.storeSlug
            ? storefrontUrl(s.cloudApiUrl, s.storeSlug)
            : null,
      });
    }
  );

  app.put(
    "/",
    {
      preHandler: [requirePermission({ settings: ["edit"] })],
      schema: { summary: "Save online store config", tags: ["storefront"] },
    },
    async (req, reply) => {
      const parsed = updateStorefrontSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const s = await app.prisma.shopSettings.findUniqueOrThrow({
        where: { id: "default" },
      });
      const modules = Array.isArray(s.cloudEntitlements)
        ? (s.cloudEntitlements as string[])
        : [];
      if (!(s.cloudShopTokenEncrypted && s.cloudApiUrl)) {
        throw new AppError("CLOUD_NOT_PAIRED");
      }
      if (!modules.includes(MODULE)) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }

      const { description, email, published, slug } = parsed.data;
      await app.prisma.shopSettings.update({
        where: { id: "default" },
        data: {
          storeDescription: description ?? null,
          storeDirty: true,
          storeEmail: email ?? null,
          storePublished: published,
          ...(slug === undefined ? {} : { storeSlug: slug || null }),
        },
      });

      // Push imediato (best-effort — se falhar, o poller repete).
      const token = decryptSecret(s.cloudShopTokenEncrypted);
      await pushStorefront(app.prisma, s.cloudApiUrl, token, req.log).catch(
        () => null
      );

      const after = await app.prisma.shopSettings.findUniqueOrThrow({
        where: { id: "default" },
      });
      return reply.send({
        description: after.storeDescription,
        dirty: after.storeDirty,
        email: after.storeEmail,
        published: after.storePublished,
        slug: after.storeSlug,
        url: after.storeSlug
          ? storefrontUrl(s.cloudApiUrl, after.storeSlug)
          : null,
      });
    }
  );
};
