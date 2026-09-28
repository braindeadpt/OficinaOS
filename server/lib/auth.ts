import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants/roles";
import { ac, roles } from "@shared/permissions";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { fromNodeHeaders } from "better-auth/node";
import { admin, username } from "better-auth/plugins";
import { loadEnv, resolveUrls } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { sendPasswordResetEmail } from "./email.js";

/**
 * Creates a Better Auth instance configured for OficinaOS.
 * Must be called after Prisma is initialized.
 */
export function createAuth(prisma: PrismaClient) {
  const env = loadEnv();
  const { apiUrl, trustedOrigins } = resolveUrls(env);
  // HTTPS on the public origin => Secure cookies; plain-HTTP LAN stays Lax.
  const isHttps = (env.APP_URL ?? apiUrl).startsWith("https://");

  return betterAuth({
    baseURL: apiUrl,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins,
    advanced: {
      // Cookie security follows the public origin's scheme instead of a
      // hardcoded value: HTTPS (public deploy, incl. Android Capacitor's
      // cross-site WebView) -> Secure + SameSite=None; plain-HTTP LAN ->
      // Lax without Secure so the browser actually stores the cookie.
      useSecureCookies: isHttps,
      defaultCookieAttributes: isHttps
        ? { sameSite: "none", secure: true, httpOnly: true }
        : { sameSite: "lax", httpOnly: true },
    },
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          await sendPasswordResetEmail(user.email, url);
        } catch (error) {
          logger.error(
            { err: error },
            "[auth] Failed to send password reset email"
          );
          throw error;
        }
      },
      onPasswordReset: async ({ user }) => {
        try {
          await prisma.auditLog.create({
            data: {
              jobId: null,
              userId: user.id,
              action: "PASSWORD_RESET",
              toValue: `Password reset for ${user.email}`,
            },
          });
        } catch (error) {
          logger.error({ err: error }, "[auth] Failed to audit password reset");
        }
      },
    },
    session: {
      expiresIn: 604_800, // 7 days
      updateAge: 86_400, // 1 day rolling
      cookieCache: {
        enabled: false,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: true,
          defaultValue: Role.FRONT_DESK,
          input: false,
        },
        isActive: {
          type: "boolean",
          required: true,
          defaultValue: true,
          input: false,
        },
        mustChangePassword: {
          type: "boolean",
          required: true,
          defaultValue: false,
          input: false,
        },
        image: {
          type: "string",
          required: false,
          defaultValue: null,
          input: false,
        },
      },
    },
    plugins: [
      username(),
      admin({
        adminRoles: [Role.OWNER],
        ac,
        roles,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Extracts session info from a Fastify request via Better Auth.
 * Returns null if no valid session, otherwise the user identity fields.
 */
export async function getSessionFromRequest(
  auth: Auth,
  request: { headers: Record<string, string | string[] | undefined> }
) {
  const headers = fromNodeHeaders(request.headers);
  const session = await auth.api.getSession({ headers });

  if (!(session?.user && session.session)) {
    return null;
  }

  return {
    id: session.user.id,
    name: (session.user.name as string) ?? "",
    username: session.user.username as string,
    email: session.user.email as string,
    role: session.user.role as string,
    isActive: session.user.isActive as boolean,
    mustChangePassword: session.user.mustChangePassword as boolean,
    sessionId: session.session.id,
  };
}
