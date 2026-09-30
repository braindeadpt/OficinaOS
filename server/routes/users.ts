import type { RoleType } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import {
  activityListQuerySchema,
  createUserSchema,
  resetPasswordSchema,
  toggleUserStatusSchema,
  updateProfileSchema,
  userIdParamSchema,
  userListQuerySchema,
} from "@shared/schemas/auth.schema";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import { deleteAvatar, uploadAvatar } from "../services/avatar.service.js";
import {
  createUser as createUserSvc,
  getActivity,
  getById,
  getSessions,
  getStats,
  list as listUsers,
  resetPassword as resetPasswordSvc,
  revokeSession as revokeSessionSvc,
  toggleStatus as toggleStatusSvc,
  updateUserProfileService,
} from "../services/user.service.js";
import { getRole, getSessionId, getUserId } from "../utils/request.js";
import {
  resolveValidationMessage,
  resolveZodErrors,
} from "../utils/resolve-validation-messages.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const usersRoutes: FastifyPluginAsync = async (app) => {
  async function canAccessUser(
    requestingUser: { id: string; role: string } | null,
    targetId: string,
    permission: Record<string, string[]>
  ): Promise<boolean> {
    if (!requestingUser) {
      return false;
    }
    if (requestingUser.id === targetId) {
      return true;
    }
    const result = await app.auth.api.userHasPermission({
      body: {
        role: requestingUser.role as RoleType,
        permissions: permission,
      },
    });
    return result.success;
  }

  app.get(
    "/",
    {
      schema: {
        tags: ["users"],
        summary: "List users",
        querystring: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ user: ["list"] })],
    },
    async (request, reply) => {
      const parsed = userListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }
      const result = await listUsers(app.prisma, parsed.data);
      return reply.send(result);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["users"],
        summary: "Get user by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      preHandler: [requirePermission({ user: ["get"] })],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = await getById(app.prisma, id);
      return reply.send(user);
    }
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["users"],
        summary: "Create user",
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ user: ["create"] })],
    },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }

      const user = await createUserSvc(
        app.prisma,
        {
          createUser: (args: unknown) =>
            app.auth.api.createUser(
              args as Parameters<typeof app.auth.api.createUser>[0]
            ),
        },
        request.headers as unknown as Headers,
        parsed.data,
        getUserId(request),
        getRole(request)
      );

      return reply.status(201).send(user);
    }
  );

  app.patch(
    "/:id/status",
    {
      schema: {
        tags: ["users"],
        summary: "Toggle user active status",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ user: ["update"] })],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = toggleUserStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }
      const { isActive } = parsed.data;

      if (id === getUserId(request) && !isActive) {
        throw new AppError("CANNOT_DEACTIVATE_OWN");
      }

      const user = await toggleStatusSvc(
        app.prisma,
        id,
        isActive,
        getRole(request)
      );
      return reply.send(user);
    }
  );

  app.post(
    "/:id/reset-password",
    {
      schema: {
        tags: ["users"],
        summary: "Reset user password",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
      preHandler: [requirePermission({ user: ["update"] })],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }

      await resetPasswordSvc(
        app.prisma,
        id,
        parsed.data.password,
        getUserId(request),
        getRole(request)
      );
      return reply.send({ success: true });
    }
  );

  app.patch(
    "/:id",
    {
      schema: {
        tags: ["users"],
        summary: "Update user profile",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: { type: "object", additionalProperties: true },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!(await canAccessUser(request.user, id, { user: ["update"] }))) {
        throw new AppError("FORBIDDEN");
      }

      const parsed = updateProfileSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }

      const updated = await updateUserProfileService(
        app.prisma,
        id,
        parsed.data
      );
      return reply.send(updated);
    }
  );

  app.get(
    "/:id/activity",
    {
      schema: {
        tags: ["users"],
        summary: "Get user activity log",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        querystring: { type: "object", additionalProperties: true },
      },
    },
    async (request, reply) => {
      const paramParsed = userIdParamSchema.safeParse(
        (request.params as { id: string }).id
      );
      if (!paramParsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: paramParsed.error
            .flatten()
            .formErrors.map((m) => resolveValidationMessage(m, request.locale)),
        });
      }
      const id = paramParsed.data;
      const queryParsed = activityListQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            queryParsed.error.flatten().fieldErrors,
            request.locale
          ),
        });
      }

      if (!(await canAccessUser(request.user, id, { user: ["list"] }))) {
        throw new AppError("FORBIDDEN");
      }

      const result = await getActivity(app.prisma, id, queryParsed.data);
      return reply.send(result);
    }
  );

  app.get(
    "/:id/stats",
    {
      schema: {
        tags: ["users"],
        summary: "Get user stats",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!(await canAccessUser(request.user, id, { user: ["list"] }))) {
        throw new AppError("FORBIDDEN");
      }

      const result = await getStats(app.prisma, id);
      return reply.send(result);
    }
  );

  app.get(
    "/:id/sessions",
    {
      schema: {
        tags: ["users"],
        summary: "List user sessions",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!(await canAccessUser(request.user, id, { session: ["list"] }))) {
        throw new AppError("FORBIDDEN");
      }

      const result = await getSessions(app.prisma, id, getSessionId(request));
      return reply.send(result);
    }
  );

  app.delete(
    "/:id/sessions/:sessionId",
    {
      schema: {
        tags: ["users"],
        summary: "Revoke user session",
        params: {
          type: "object",
          properties: { id: { type: "string" }, sessionId: { type: "string" } },
          required: ["id", "sessionId"],
        },
      },
    },
    async (request, reply) => {
      const { id, sessionId } = request.params as {
        id: string;
        sessionId: string;
      };

      if (!(await canAccessUser(request.user, id, { session: ["revoke"] }))) {
        throw new AppError("FORBIDDEN");
      }

      await revokeSessionSvc(app.prisma, id, sessionId, getSessionId(request));
      return reply.send({ success: true });
    }
  );

  app.post(
    "/:id/avatar",
    {
      schema: {
        tags: ["users"],
        summary: "Upload user avatar",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        consumes: ["multipart/form-data"],
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (getUserId(request) !== id) {
        throw new AppError("AVATAR_NOT_OWN");
      }

      const data = await request.file();
      if (!data) {
        throw new AppError("NO_FILE_UPLOADED");
      }

      const result = await uploadAvatar(app.prisma, id, data);
      if (!result) {
        throw new AppError("USER_NOT_FOUND");
      }
      if ("error" in result && result.error) {
        throw new AppError(result.error);
      }

      return reply.send(result);
    }
  );

  app.delete(
    "/:id/avatar",
    {
      schema: {
        tags: ["users"],
        summary: "Delete user avatar",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (getUserId(request) !== id) {
        throw new AppError("AVATAR_NOT_OWN");
      }

      const result = await deleteAvatar(app.prisma, id);
      if (!result) {
        throw new AppError("USER_NOT_FOUND");
      }

      return reply.send(result);
    }
  );
};
