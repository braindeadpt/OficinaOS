import { AppError, throwIfError } from "@shared/errors/app-error.js";
import type { PermissionCheck } from "@shared/permissions";
import {
  createReturnClaimSchema,
  listReturnClaimsQuerySchema,
  resolveReturnClaimSchema,
  triageReturnClaimSchema,
  uploadClaimPhotoSchema,
} from "@shared/schemas/return-claim.schema.js";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  create as createClaim,
  detachRework,
  getById as getClaim,
  list as listClaims,
  removePhoto,
  resolve as resolveClaim,
  spawnRework,
  triage,
  uploadPhoto,
} from "../services/return-claim.service.js";
import { getRole, getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const returnClaimsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requirePermission({ returns: ["viewSelf"] }));

  /** Users without returns:viewShop only see claims they opened or that
   *  belong to jobs assigned to them — never refund/financial details of
   *  the whole shop. */
  async function selfScopeUserId(req: {
    user?: unknown;
  }): Promise<string | undefined> {
    const canViewShop = await app.auth.api.userHasPermission({
      body: {
        role: getRole(req as Parameters<typeof getRole>[0]),
        permissions: { returns: ["viewShop"] },
      },
    });
    return canViewShop.success
      ? undefined
      : getUserId(req as Parameters<typeof getUserId>[0]);
  }

  app.post(
    "/",
    {
      preHandler: [requirePermission({ returns: ["create"] })],
      schema: {
        tags: ["returns"],
        summary: "Create a return claim",
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = createReturnClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await createClaim(app.prisma, parsed.data, userId);
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["returns"],
        summary: "List return claims",
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const parsed = listReturnClaimsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const scopeUserId = await selfScopeUserId(req);
      const result = await listClaims(app.prisma, parsed.data, scopeUserId);
      return reply.send(result);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["returns"],
        summary: "Get return claim by id",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const scopeUserId = await selfScopeUserId(req);
      const claim = await getClaim(app.prisma, id, scopeUserId);
      if (!claim) {
        throw new AppError("RETURN_CLAIM_NOT_FOUND");
      }
      return reply.send(claim);
    }
  );

  app.patch(
    "/:id/triage",
    {
      preHandler: [requirePermission({ returns: ["triage"] })],
      schema: {
        tags: ["returns"],
        summary: "Set fault category on a claim",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = triageReturnClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const result = await triage(app.prisma, id, parsed.data);
      throwIfError(result);
      return reply.send(result);
    }
  );

  app.post(
    "/:id/spawn-rework",
    {
      preHandler: [requirePermission({ returns: ["resolveRework"] })],
      schema: {
        tags: ["returns"],
        summary: "Spawn a rework job for a claim",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const userId = getUserId(req);
      const result = await spawnRework(app.prisma, id, userId);
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.post(
    "/:id/detach-rework",
    {
      preHandler: [requirePermission({ returns: ["edit"] })],
      schema: {
        tags: ["returns"],
        summary: "Detach a rework job from a claim",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await detachRework(app.prisma, id);
      throwIfError(result);
      return reply.send(result);
    }
  );

  app.patch(
    "/:id/resolve",
    {
      preHandler: [
        async (req, reply) => {
          const body = req.body as { resolutionOutcome?: string };
          const isRefund =
            body.resolutionOutcome === "REFUND_PARTIAL" ||
            body.resolutionOutcome === "REFUND_FULL";
          const perm = isRefund
            ? { returns: ["resolveRefund"] }
            : { returns: ["resolveRework"] };
          await requirePermission(perm as PermissionCheck)(req, reply);
        },
      ],
      schema: {
        tags: ["returns"],
        summary: "Resolve a return claim",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = resolveReturnClaimSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await resolveClaim(app.prisma, id, parsed.data, userId);
      throwIfError(result);
      return reply.send(result);
    }
  );

  app.post(
    "/:id/photos",
    {
      preHandler: [requirePermission({ returns: ["edit"] })],
      schema: {
        tags: ["returns"],
        summary: "Upload claim photo",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        consumes: ["multipart/form-data"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const data = await req.file();
      if (!data) {
        throw new AppError("NO_FILE_UPLOADED");
      }
      const stage = (data.fields.stage as { value?: string } | undefined)
        ?.value;
      const parsed = uploadClaimPhotoSchema.safeParse({ stage });
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const userId = getUserId(req);
      const result = await uploadPhoto(
        app.prisma,
        id,
        data,
        parsed.data.stage,
        userId
      );
      throwIfError(result);
      return reply.status(201).send(result);
    }
  );

  app.delete(
    "/:id/photos/:photoId",
    {
      preHandler: [requirePermission({ returns: ["edit"] })],
      schema: {
        tags: ["returns"],
        summary: "Remove claim photo",
        params: {
          type: "object",
          properties: {
            id: { type: "string" },
            photoId: { type: "string" },
          },
          required: ["id", "photoId"],
        },
      },
    },
    async (req, reply) => {
      const { id, photoId } = req.params as { id: string; photoId: string };
      const result = await removePhoto(app.prisma, id, photoId, getUserId(req));
      throwIfError(result);
      return reply.status(204).send();
    }
  );
};
