import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@generated/client";

/**
 * Tokens pessoais MCP ("oos_*") — só de leitura, guardados como hash SHA-256.
 * Herdam as permissões do utilizador dono em cada chamada (um técnico não
 * lê o que não pode ver na app).
 */

export const MCP_RATE_LIMIT_PER_MINUTE = 60;

export interface McpAuth {
  showPii: boolean;
  tokenId: string;
  userId: string;
  userName: string;
  userRole: string;
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateToken(): {
  plaintext: string;
  prefix: string;
  tokenHash: string;
} {
  const plaintext = `oos_${randomBytes(24).toString("hex")}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 10),
    tokenHash: hashToken(plaintext),
  };
}

/**
 * Resolves a plaintext token to its owner. Returns null when unknown,
 * revoked or expired — the caller answers 401 either way, without saying why.
 */
export async function authenticateToken(
  prisma: PrismaClient,
  plaintext: string
): Promise<McpAuth | null> {
  if (!plaintext.startsWith("oos_")) {
    return null;
  }
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashToken(plaintext) },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          name: true,
          isActive: true,
          banned: true,
        },
      },
    },
  });
  if (!row || row.revokedAt) {
    return null;
  }
  // Conta desativada ou banida: os tokens morrem com ela.
  if (!row.user.isActive || row.user.banned) {
    return null;
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return null;
  }
  // lastUsedAt — melhor esforço, nunca bloqueia a chamada.
  prisma.mcpToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  return {
    tokenId: row.id,
    userId: row.user.id,
    userRole: row.user.role,
    userName: row.user.name,
    showPii: row.showPii,
  };
}

// ── Rate limit: janela deslizante em memória, por token ────────────────────
// 60 chamadas/minuto. Em memória chega: o servidor MCP corre num único
// processo local; no pior caso um reinício zera a janela.

const windows = new Map<string, number[]>();

export function rateLimitOk(
  tokenId: string,
  now = Date.now(),
  max = MCP_RATE_LIMIT_PER_MINUTE
): boolean {
  const windowMs = 60_000;
  const stamps = (windows.get(tokenId) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length >= max) {
    windows.set(tokenId, stamps);
    return false;
  }
  stamps.push(now);
  windows.set(tokenId, stamps);
  return true;
}

/** Test hook — limpa as janelas entre testes. */
export function resetRateLimits(): void {
  windows.clear();
}
