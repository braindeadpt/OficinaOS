import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@generated/client";
import { Role } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import { hashPassword } from "better-auth/crypto";

/**
 * First-run setup: while the database has no users, the app shows a
 * «Criar a sua oficina» screen instead of the login. It replaces the old
 * hardcoded seed admin (same password on every install).
 *
 * Who may run it: a browser on the server PC itself (loopback — the
 * installer and INICIAR scripts open http://localhost:4000), or anyone
 * holding the one-time SETUP_TOKEN from the server's .env (Docker, where
 * requests arrive from the bridge gateway, not loopback). The endpoint dies
 * for good as soon as the first user exists, which is what makes the token
 * single-use.
 */

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// A local reverse proxy / tunnel (cloudflared, Caddy) connects from
// loopback on behalf of a remote visitor. Any forwarding header means the
// real client is somewhere else, so it never counts as local.
const FORWARDING_HEADERS = [
  "x-forwarded-for",
  "forwarded",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
];

// Arbitrary constant: serializes concurrent setup attempts on one
// Postgres advisory lock so two requests can never both see 0 users.
const SETUP_LOCK_KEY = 74_260_001;

const FALLBACK_EMAIL_DOMAIN = "oficinaos.local";
const USERNAME_MAX = 30;
const USERNAME_MIN = 3;
const USERNAME_STRIP = /[^a-z0-9_]/g;

export interface SetupRequestInfo {
  headers: Record<string, string | string[] | undefined>;
  ip: string;
}

export function isLoopbackRequest(req: SetupRequestInfo): boolean {
  if (!LOOPBACK_ADDRESSES.has(req.ip)) {
    return false;
  }
  return !FORWARDING_HEADERS.some((h) => req.headers[h] !== undefined);
}

export function setupTokenMatches(
  provided: string | undefined,
  expected: string | undefined
): boolean {
  if (!(provided && expected)) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isSetupAllowed(
  req: SetupRequestInfo,
  token: string | undefined,
  expectedToken: string | undefined
): boolean {
  return isLoopbackRequest(req) || setupTokenMatches(token, expectedToken);
}

export async function isSetupNeeded(
  prisma: Pick<PrismaClient, "user">
): Promise<boolean> {
  return (await prisma.user.count()) === 0;
}

/**
 * Splits the single «utilizador ou email» field into the username + email
 * pair better-auth needs. Usernames are stored lowercase (the username
 * plugin normalizes sign-in input the same way).
 */
export function deriveIdentity(login: string): {
  displayUsername: string;
  email: string;
  username: string;
} {
  const trimmed = login.trim();
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    let username = (email.split("@")[0] ?? "")
      .replace(USERNAME_STRIP, "_")
      .slice(0, USERNAME_MAX);
    if (username.length < USERNAME_MIN) {
      username = username.padEnd(USERNAME_MIN, "_");
    }
    return { username, displayUsername: username, email };
  }
  const username = trimmed.toLowerCase();
  return {
    username,
    displayUsername: trimmed,
    email: `${username}@${FALLBACK_EMAIL_DOMAIN}`,
  };
}

export interface CreateFirstOwnerInput {
  login: string;
  name: string;
  password: string;
  shopName: string;
}

/**
 * Creates the first OWNER atomically. The advisory lock plus the user count
 * inside the same transaction is the guard: a second concurrent request
 * waits on the lock, then sees 1 user and gets SETUP_ALREADY_DONE.
 */
export async function createFirstOwner(
  prisma: Pick<PrismaClient, "$transaction">,
  input: CreateFirstOwnerInput
): Promise<{ email: string; id: string; username: string }> {
  const identity = deriveIdentity(input.login);
  // Same hasher better-auth uses for credential accounts (scrypt), so the
  // normal sign-in path verifies this password unchanged.
  const passwordHash = await hashPassword(input.password);

  return await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;

    const existing = await tx.user.count();
    if (existing > 0) {
      throw new AppError("SETUP_ALREADY_DONE");
    }

    const user = await tx.user.create({
      data: {
        name: input.name.trim(),
        username: identity.username,
        displayUsername: identity.displayUsername,
        email: identity.email,
        emailVerified: false,
        role: Role.OWNER,
        isActive: true,
        mustChangePassword: false,
      },
      select: { id: true, username: true, email: true },
    });

    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
      },
    });

    await tx.shopSettings.upsert({
      where: { id: "default" },
      create: { id: "default", shopName: input.shopName.trim() },
      update: { shopName: input.shopName.trim() },
    });

    await tx.auditLog.create({
      data: {
        jobId: null,
        userId: user.id,
        action: "USER_CREATED",
        toValue: `${user.username} (${Role.OWNER}) via first-run setup`,
      },
    });

    return user;
  });
}
