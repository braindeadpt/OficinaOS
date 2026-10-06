import { AppError } from "@shared/errors/app-error.js";
import { updateStorefrontSchema } from "@shared/schemas/storefront.schema";
import type { FastifyPluginAsync } from "fastify";
import { decryptSecret } from "../lib/crypto.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import {
  pushStorefront,
  storefrontUrl,
} from "../services/storefront.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const MODULE = "storefront";
// Paid design tier — accent color, logo and layout. Enforced here for a
// fast UI error; the cloud re-checks the entitlement on every push.
const PLUS_MODULE = "storefront-plus";

interface ThemeInput {
  accentColor?: string | undefined;
  logo?: string | undefined;
  template?: "vitrine" | "compacta" | undefined;
}

/** Paid theme fields → shop_settings columns ("" clears to null). */
function themePatch(input: ThemeInput) {
  return {
    ...(input.accentColor === undefined
      ? {}
      : { storeAccentColor: input.accentColor || null }),
    ...(input.template === undefined ? {} : { storeTemplate: input.template }),
    ...(input.logo === undefined ? {} : { storeLogoData: input.logo || null }),
  };
}

function hasThemeInput(input: ThemeInput): boolean {
  return (
    input.accentColor !== undefined ||
    input.template !== undefined ||
    input.logo !== undefined
  );
}

interface SettingsView {
  storeAccentColor: string | null;
  storeDescription: string | null;
  storeDirty: boolean;
  storeEmail: string | null;
  storeLogoData: string | null;
  storePublished: boolean;
  storeSlug: string | null;
  storeTemplate: string | null;
}

function storefrontView(s: SettingsView, apiUrl: string | null) {
  return {
    accentColor: s.storeAccentColor,
    description: s.storeDescription,
    dirty: s.storeDirty,
    email: s.storeEmail,
    logoData: s.storeLogoData,
    published: s.storePublished,
    slug: s.storeSlug,
    template: s.storeTemplate ?? "vitrine",
    url: apiUrl && s.storeSlug ? storefrontUrl(apiUrl, s.storeSlug) : null,
  };
}

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
      const s = await getOrCreateShopSettings(app.prisma);
      const modules = Array.isArray(s.cloudEntitlements)
        ? (s.cloudEntitlements as string[])
        : [];
      const itemCount = await app.prisma.partsCatalog.count({
        where: { listedOnline: true, isActive: true },
      });
      return reply.send({
        ...storefrontView(s, s.cloudApiUrl),
        itemCount,
        module: modules.includes(MODULE),
        paired: Boolean(s.cloudShopTokenEncrypted),
        plus: modules.includes(PLUS_MODULE),
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
      const s = await getOrCreateShopSettings(app.prisma);
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
      // Paid theme fields require storefront-plus — rejected before save.
      if (hasThemeInput(parsed.data) && !modules.includes(PLUS_MODULE)) {
        throw new AppError("CLOUD_MODULE_REQUIRED");
      }
      await app.prisma.shopSettings.update({
        where: { id: "default" },
        data: {
          storeDescription: description ?? null,
          storeDirty: true,
          storeEmail: email ?? null,
          storePublished: published,
          ...(slug === undefined ? {} : { storeSlug: slug || null }),
          ...themePatch(parsed.data),
        },
      });

      // Push imediato (best-effort — se falhar, o poller repete).
      const token = decryptSecret(s.cloudShopTokenEncrypted);
      await pushStorefront(app.prisma, s.cloudApiUrl, token, req.log).catch(
        () => null
      );

      const after = await getOrCreateShopSettings(app.prisma);
      return reply.send(storefrontView(after, s.cloudApiUrl));
    }
  );
};
