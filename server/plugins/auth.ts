import type { PrismaClient } from "@generated/client";
import { AppError, isAppError } from "@shared/errors/app-error.js";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Auth } from "../lib/auth.js";
import { createAuth, getSessionFromRequest } from "../lib/auth.js";
import {
  incrementFailedAttempt,
  isAccountLocked,
  resetFailedAttempts,
} from "../services/account-lockout.service.js";
import { logger } from "../utils/logger.js";

async function auditSignIn(
  auth: Auth,
  headers: Headers,
  prisma: PrismaClient
): Promise<void> {
  try {
    const session = await auth.api.getSession({ headers });
    if (session?.user) {
      await prisma.auditLog.create({
        data: {
          jobId: null,
          userId: session.user.id,
          action: "USER_SIGN_IN",
          toValue: `Sign-in for ${session.user.username ?? session.user.email}`,
        },
      });
      await resetFailedAttempts(prisma, session.user.id);
    }
  } catch (error) {
    logger.warn({ err: error }, "Audit sign-in failure");
  }
}

function extractBody(method: string, body: unknown): string | undefined {
  const isMutation =
    method === "POST" || method === "PUT" || method === "PATCH";
  return isMutation && body ? JSON.stringify(body) : undefined;
}

function sanitizeSignInResponse(
  text: string,
  method: string,
  pathname: string
): string {
  if (!text || method !== "POST" || !pathname.includes("sign-in")) {
    return text;
  }
  try {
    const json = JSON.parse(text);
    if (json.user) {
      const { image: _image, ...userWithoutImage } = json.user;
      json.user = userWithoutImage;
    }
    return JSON.stringify(json);
  } catch {
    return text;
  }
}

async function handleFailedSignIn(
  prisma: PrismaClient,
  request: { method: string; body: unknown }
): Promise<void> {
  try {
    const raw =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const identifier = raw.username ?? raw.email;
    if (typeof identifier !== "string") {
      return;
    }
    // better-auth normalizes the sign-in identifier to lowercase —
    // "Admin" authenticates as "admin", so lockout tracking must
    // key on the same normalized form or each casing variant gets
    // a fresh failure budget.
    const normalized = identifier.toLowerCase().trim();
    const user = await prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
      select: { id: true },
    });
    if (user) {
      await incrementFailedAttempt(prisma, user.id);
    }
  } catch (error) {
    logger.warn({ err: error }, "Failed sign-in lockout tracking error");
  }
}

function isSignInPost(method: string, pathname: string): boolean {
  return method === "POST" && pathname.includes("sign-in");
}

async function forwardResponse(
  response: Response,
  reply: {
    header: (k: string, v: string) => void;
    send: (body: unknown) => void;
    status: (code: number) => { send: (body: unknown) => void };
  },
  method: string,
  pathname: string
): Promise<void> {
  reply.status(response.status);
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() !== "content-length") {
      reply.header(key, value);
    }
  }
  const text = await response.text();
  const sanitized = sanitizeSignInResponse(text, method, pathname);
  reply.send(sanitized ?? null);
}

async function checkSignInLockout(
  prisma: PrismaClient,
  request: { method: string; body: unknown }
): Promise<void> {
  if (request.method !== "POST") {
    return;
  }
  const reqBody =
    typeof request.body === "object" && request.body !== null
      ? (request.body as Record<string, unknown>)
      : {};
  const identifier = reqBody.username ?? reqBody.email;
  if (typeof identifier !== "string") {
    return;
  }
  // Same normalization as the sign-in path — a case variant must not
  // skip the lockout check.
  const normalized = identifier.toLowerCase().trim();
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: normalized }, { email: normalized }] },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
  if (user && isAccountLocked(user)) {
    throw new AppError("ACCOUNT_LOCKED");
  }
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
const authPlugin: FastifyPluginAsync = async (app) => {
  const prisma = app.prisma;
  const auth = createAuth(prisma);

  app.decorate("auth", auth);
  app.decorateRequest("user", null);

  app.all("/api/auth/*", async (request, reply) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const body = extractBody(request.method, request.body);

      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
      });

      if (isSignInPost(request.method, url.pathname)) {
        await checkSignInLockout(prisma, request);
      }

      const response = await auth.handler(req);

      if (
        response.status === 200 &&
        isSignInPost(request.method, url.pathname)
      ) {
        await auditSignIn(auth, headers, prisma);
      }

      if (
        response.status !== 200 &&
        isSignInPost(request.method, url.pathname)
      ) {
        await handleFailedSignIn(prisma, request);
      }

      app.log.info(
        { status: response.status, path: url.pathname, method: request.method },
        "Better Auth handler response"
      );

      await forwardResponse(response, reply, request.method, url.pathname);
    } catch (err) {
      // AppErrors raised by our own guards (e.g. ACCOUNT_LOCKED from the
      // sign-in precheck) must surface intact — wrapping them as 500
      // would both hide the real status and mislead the client.
      if (isAppError(err)) {
        throw err;
      }
      app.log.error(err, "Better Auth handler error");
      throw new AppError("INTERNAL_ERROR");
    }
  });

  app.addHook("preHandler", async (request, _reply) => {
    const url = request.url;
    const pathname = url.split("?")[0];

    if (
      pathname === "/health" ||
      pathname === "/api/csrf-token" ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/jobs/lookup") ||
      pathname.startsWith("/api/public")
    ) {
      return;
    }

    if (!pathname.startsWith("/api")) {
      return;
    }

    const session = await getSessionFromRequest(auth, request);

    if (!session) {
      throw new AppError("UNAUTHORIZED");
    }

    if (!session.isActive) {
      throw new AppError("ACCOUNT_DISABLED");
    }

    const lockoutUser = await app.prisma.user.findUnique({
      where: { id: session.id },
      select: { failedLoginAttempts: true, lockedUntil: true },
    });
    if (lockoutUser && isAccountLocked(lockoutUser)) {
      throw new AppError("ACCOUNT_LOCKED");
    }

    // The forced rotation must hold server-side too — a session with
    // mustChangePassword can otherwise call every API route directly
    // (the /api/auth/* endpoints it needs are exempted above).
    if (session.mustChangePassword) {
      throw new AppError("PASSWORD_CHANGE_REQUIRED");
    }

    request.user = session;
  });
};

export default fp(authPlugin);

declare module "fastify" {
  interface FastifyInstance {
    auth: Auth;
  }
  interface FastifyRequest {
    user: {
      id: string;
      name: string;
      username: string;
      email: string;
      role: string;
      isActive: boolean;
      mustChangePassword: boolean;
      sessionId: string;
    } | null;
  }
}
