import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { generateToken } from "../mcp/tokens.js";

/**
 * Gestão de tokens pessoais MCP ("oos_*") — self-service: cada utilizador
 * cria, lista e revoga os SEUS tokens. O plaintext é devolvido uma única
 * vez na criação; na base de dados fica só o hash SHA-256.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresAt: z.string().datetime().optional(),
  // Opt-in RGPD: mostrar dados pessoais em claro (vão para o fornecedor do
  // LLM). Por omissão ficam mascarados.
  showPii: z.boolean().optional().default(false),
});

function serialize(t: {
  id: string;
  name: string;
  prefix: string;
  showPii: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    showPii: t.showPii,
    expiresAt: t.expiresAt,
    lastUsedAt: t.lastUsedAt,
    revoked: t.revokedAt !== null,
    createdAt: t.createdAt,
  };
}

function requireUserId(req: { user?: { id: string } | null }): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED");
  }
  return req.user.id;
}

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const mcpTokenRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => {
    const userId = requireUserId(req);
    const rows = await app.prisma.mcpToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(serialize);
  });

  app.post("/", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR");
    }
    const { name, expiresAt, showPii } = parsed.data;
    const expiryDate = expiresAt ? new Date(expiresAt) : null;
    if (expiryDate && expiryDate.getTime() <= Date.now()) {
      throw new AppError("VALIDATION_ERROR");
    }
    const userId = requireUserId(req);
    const { plaintext, prefix, tokenHash } = generateToken();
    const row = await app.prisma.mcpToken.create({
      data: {
        userId,
        name,
        prefix,
        tokenHash,
        showPii,
        expiresAt: expiryDate,
      },
    });
    // O plaintext só existe aqui — nunca mais é possível recuperá-lo.
    return reply.code(201).send({ ...serialize(row), token: plaintext });
  });

  app.delete("/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = await app.prisma.mcpToken.findFirst({
      where: { id, userId: requireUserId(req) },
    });
    if (!row) {
      throw new AppError("NOT_FOUND");
    }
    if (!row.revokedAt) {
      await app.prisma.mcpToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  });
};
