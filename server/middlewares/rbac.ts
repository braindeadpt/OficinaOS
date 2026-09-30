import type { RoleType } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import type { PermissionCheck } from "@shared/permissions";
import type { FastifyReply, FastifyRequest } from "fastify";

export function requirePermission(permissions: PermissionCheck) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    // Routes flagged public (e.g. customer self-tracking) skip the check —
    // they are also allowlisted by path in plugins/auth.ts. An empty
    // `preHandler: []` on a route does NOT remove plugin hooks, so this
    // config flag is the working bypass.
    if (
      (request.routeOptions?.config as { public?: boolean } | undefined)
        ?.public === true
    ) {
      return;
    }
    if (!request.user) {
      throw new AppError("UNAUTHORIZED");
    }

    const result = await request.server.auth.api.userHasPermission({
      body: {
        role: request.user.role as RoleType,
        permissions,
      },
    });

    if (!result.success) {
      throw new AppError("FORBIDDEN");
    }
  };
}
