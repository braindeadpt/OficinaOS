import { AppError } from "@shared/errors/app-error.js";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decryptSecret } from "../lib/crypto.js";
import { requirePermission } from "../middlewares/rbac.js";
import { getOrCreateShopSettings } from "../repositories/settings.repository.js";
import { cloudFetch } from "../services/cloud.service.js";
import {
  cleanupInboxRetention,
  markConversationRead,
} from "../services/inbox.service.js";
import { askStaffAi } from "../services/staff-ai.service.js";
import {
  runStaffInboxTool,
  sendApprovedDraft,
} from "../services/staff-inbox-tools.js";
import { isModuleEnabled } from "../utils/modules.js";
import { getUserId } from "../utils/request.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

/**
 * API interna da caixa de entrada (módulo Pro "ai-inbox", §G).
 *
 * Todas as rotas exigem o entitlement Cloud ativo — não basta a
 * permissão local (regra dos módulos Pro: gate vem da verificação de
 * entitlements, não de uma flag). RBAC por ação:
 *  - view  → ler conversas/mensagens, procurar, tokens MCP do próprio;
 *  - send  → responder, aprovar rascunhos, marcar estado, chat IA;
 *  - manage→ atribuir conversas a utilizadores.
 */

const filtroSchema = z.object({
  canal: z.string().trim().max(20).optional(),
  desde: z.iso.datetime().optional(),
  estado: z.enum(["aberta", "pendente", "fechada"]).optional(),
  filtro: z
    .enum(["atribuidas_a_mim", "escaladas", "nao_lidas", "sem_resposta"])
    .optional(),
});

const messagesQuerySchema = z.object({
  cursor: z.string().max(60).optional(),
  limite: z.coerce.number().int().min(1).max(50).default(30),
});

const assignSchema = z.object({ utilizadorId: z.string().min(1).max(60) });
const statusSchema = z.object({
  estado: z.enum(["aberta", "pendente", "fechada", "lida", "escalada"]),
});
const replySchema = z.object({
  texto: z.string().trim().min(1).max(4000),
});
const aiReplySchema = z.object({
  messages: z
    .array(
      z.object({
        content: z.string().max(20_000),
        role: z.enum(["user", "assistant"]),
      })
    )
    .min(1)
    .max(40),
});
const mcpTokenCreateSchema = z.object({
  label: z.string().trim().min(1).max(120),
});
const mcpPrefsSchema = z.object({ mcpDirectSend: z.boolean() });

interface Params {
  id: string;
}

async function assertInboxEnabled(
  prisma: Parameters<typeof getOrCreateShopSettings>[0]
) {
  const settings = await getOrCreateShopSettings(prisma);
  if (!isModuleEnabled(settings, "ai-inbox")) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  return settings;
}

function parse<T>(schema: z.ZodType<T>, data: unknown, locale: string): T {
  const out = schema.safeParse(data);
  if (!out.success) {
    throw new AppError("VALIDATION_ERROR", {
      errors: resolveZodErrors(out.error.flatten().fieldErrors, locale),
    });
  }
  return out.data;
}

/** Proxy MCP: Cloud guarda os tokens por userId — a app reencaminha. */
async function mcpProxy(
  prisma: Parameters<typeof getOrCreateShopSettings>[0],
  method: "DELETE" | "GET" | "POST",
  path: string,
  userId: string,
  body?: unknown
) {
  const settings = await getOrCreateShopSettings(prisma);
  const token = settings.cloudShopTokenEncrypted
    ? decryptSecret(settings.cloudShopTokenEncrypted)
    : null;
  if (!(settings.cloudApiUrl && token)) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  const sep = path.includes("?") ? "&" : "?";
  const res = await cloudFetch(
    settings.cloudApiUrl,
    `${path}${sep}userId=${encodeURIComponent(userId)}`,
    {
      body: method === "GET" || method === "DELETE" ? undefined : body,
      method,
      token,
    }
  ).catch(() => null);
  if (!res) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  if (res.status === 402 || res.status === 403) {
    throw new AppError("CLOUD_MODULE_REQUIRED");
  }
  if (res.status === 401) {
    throw new AppError("UNAUTHORIZED");
  }
  if (!res.ok) {
    throw new AppError("CLOUD_UNREACHABLE");
  }
  return res.body;
}

const ESTADO_TO_STATUS = {
  aberta: "OPEN",
  fechada: "CLOSED",
  pendente: "PENDING",
} as const;

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const inboxRoutes: FastifyPluginAsync = async (app) => {
  // Estado do módulo para a UI esconder/mostrar a entrada — sem dados.
  app.get(
    "/status",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "ai-inbox module status", tags: ["inbox"] },
    },
    async (_req, reply) => {
      const settings = await getOrCreateShopSettings(app.prisma);
      return reply.send({ enabled: isModuleEnabled(settings, "ai-inbox") });
    }
  );

  app.get(
    "/conversations",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "List inbox conversations", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const q = parse(filtroSchema, req.query, req.locale);
      const filtro = q.filtro;
      const rows = await app.prisma.inboxConversation.findMany({
        include: {
          assignedTo: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          messages: {
            orderBy: { receivedAt: "desc" as const },
            select: { body: true, direction: true, receivedAt: true },
            take: 1,
          },
        },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        where: {
          ...(q.canal ? { channel: q.canal } : {}),
          ...(q.desde ? { lastMessageAt: { gte: new Date(q.desde) } } : {}),
          ...(q.estado ? { status: ESTADO_TO_STATUS[q.estado] } : {}),
          ...(filtro === "nao_lidas" ? { unreadCount: { gt: 0 } } : {}),
          ...(filtro === "atribuidas_a_mim"
            ? { assignedToId: getUserId(req) }
            : {}),
          ...(filtro === "escaladas" ? { escalatedAt: { not: null } } : {}),
          ...(filtro === "sem_resposta"
            ? { lastInboundAt: { not: null } }
            : {}),
        },
      });
      const data = rows
        .filter(
          (c) =>
            filtro !== "sem_resposta" ||
            !c.lastOutboundAt ||
            (c.lastInboundAt ?? new Date(0)) > c.lastOutboundAt
        )
        .map((c) => ({
          assignedTo: c.assignedTo,
          channel: c.channel,
          customer: c.customer,
          escalatedAt: c.escalatedAt,
          id: c.id,
          lastInboundAt: c.lastInboundAt,
          lastMessageAt: c.lastMessageAt,
          lastMessagePreview: c.messages[0]?.body.slice(0, 140) ?? null,
          lastOutboundAt: c.lastOutboundAt,
          phone: c.phone,
          status: c.status,
          unreadCount: c.unreadCount,
        }));
      return reply.send({ data });
    }
  );

  app.get(
    "/conversations/:id",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "Get one conversation", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const conv = await app.prisma.inboxConversation.findUnique({
        include: {
          assignedTo: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true, phone: true } },
        },
        where: { id },
      });
      if (!conv) {
        throw new AppError("NOT_FOUND");
      }
      return reply.send({ data: conv });
    }
  );

  app.get(
    "/conversations/:id/messages",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "List conversation messages", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const q = parse(messagesQuerySchema, req.query, req.locale);
      const rows = await app.prisma.businessMessage.findMany({
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: { receivedAt: "desc" },
        select: {
          createdBy: { select: { id: true, name: true } },
          deliveryStatus: true,
          direction: true,
          body: true,
          handledBy: true,
          id: true,
          readAt: true,
          receivedAt: true,
        },
        take: q.limite,
        where: { conversationId: id },
      });
      return reply.send({
        data: rows,
        nextCursor: rows.length === q.limite ? rows.at(-1)?.id : null,
      });
    }
  );

  app.post(
    "/conversations/:id/read",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Mark conversation read", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const conv = await app.prisma.inboxConversation.findUnique({
        select: { id: true },
        where: { id },
      });
      if (!conv) {
        throw new AppError("NOT_FOUND");
      }
      await markConversationRead(app.prisma, id);
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/conversations/:id/assign",
    {
      preHandler: [requirePermission({ inbox: ["manage"] })],
      schema: { summary: "Assign conversation to a user", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const body = parse(assignSchema, req.body, req.locale);
      const target = await app.prisma.user.findUnique({
        select: { active: true, id: true, name: true },
        where: { id: body.utilizadorId },
      });
      if (!target?.active) {
        throw new AppError("VALIDATION_ERROR");
      }
      const conv = await app.prisma.inboxConversation
        .update({ data: { assignedToId: target.id }, where: { id } })
        .catch(() => null);
      if (!conv) {
        throw new AppError("NOT_FOUND");
      }
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/conversations/:id/status",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Set conversation status", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const body = parse(statusSchema, req.body, req.locale);
      const conv = await app.prisma.inboxConversation.findUnique({
        select: { id: true },
        where: { id },
      });
      if (!conv) {
        throw new AppError("NOT_FOUND");
      }
      if (body.estado === "lida") {
        await markConversationRead(app.prisma, id);
      } else if (body.estado === "escalada") {
        await app.prisma.inboxConversation.update({
          data: { escalatedAt: new Date(), status: "OPEN" },
          where: { id },
        });
      } else {
        await app.prisma.inboxConversation.update({
          data: { status: ESTADO_TO_STATUS[body.estado] },
          where: { id },
        });
      }
      return reply.send({ ok: true });
    }
  );

  // Resposta direta do staff — o humano que escreve É a aprovação
  // (§G.5): cria-se o rascunho já aprovado e envia-se uma vez.
  app.post(
    "/conversations/:id/reply",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Staff reply (create+approve+send)", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const body = parse(replySchema, req.body, req.locale);
      const conv = await app.prisma.inboxConversation.findUnique({
        select: { id: true },
        where: { id },
      });
      if (!conv) {
        throw new AppError("NOT_FOUND");
      }
      const userId = getUserId(req);
      const draft = await app.prisma.inboxDraft.create({
        data: {
          approvedAt: new Date(),
          approvedById: userId,
          conversationId: id,
          createdById: userId,
          status: "PENDING",
          text: body.texto,
        },
        select: { id: true },
      });
      const out = await sendApprovedDraft(
        app.prisma,
        app.log,
        draft.id,
        userId
      );
      if (out.error) {
        throw new AppError("VALIDATION_ERROR", { message: out.error });
      }
      return reply.send({ ok: true });
    }
  );

  app.get(
    "/drafts",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "Pending inbox drafts", tags: ["inbox"] },
    },
    async (_req, reply) => {
      await assertInboxEnabled(app.prisma);
      const rows = await app.prisma.inboxDraft.findMany({
        include: {
          conversation: {
            select: {
              channel: true,
              customer: { select: { name: true } },
              id: true,
              phone: true,
            },
          },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
        where: { status: "PENDING" },
      });
      return reply.send({ data: rows });
    }
  );

  // Aprovação humana do rascunho (§G.5) — marca e envia uma vez.
  app.post(
    "/drafts/:id/approve",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Approve and send a draft", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const draft = await app.prisma.inboxDraft.findUnique({
        select: { approvedAt: true, status: true },
        where: { id },
      });
      if (!draft) {
        throw new AppError("NOT_FOUND");
      }
      if (draft.status === "CANCELLED") {
        throw new AppError("CONFLICT");
      }
      const userId = getUserId(req);
      if (!draft.approvedAt) {
        // Aprovação atómica: dois cliques concorrentes — só quem ganha o
        // updateMany aprova; quem perde cai no sendApprovedDraft que por
        // sua vez reclama o envio de forma exclusiva (SENDING).
        const won = await app.prisma.inboxDraft.updateMany({
          data: { approvedAt: new Date(), approvedById: userId },
          where: { approvedAt: null, id, status: { in: ["DRAFT", "PENDING"] } },
        });
        if (won.count === 0) {
          const now = await app.prisma.inboxDraft.findUnique({
            select: { approvedAt: true },
            where: { id },
          });
          if (!now?.approvedAt) {
            throw new AppError("CONFLICT");
          }
        }
      }
      const out = await sendApprovedDraft(app.prisma, app.log, id, userId);
      if (out.error) {
        // Idempotente: um segundo «Aprovar e enviar» durante o envio do
        // primeiro não é erro — a mensagem já está reservada (SENDING)
        // ou enviada; devolver ok evita retry duplicado do cliente.
        const st = (
          await app.prisma.inboxDraft.findUnique({
            select: { status: true },
            where: { id },
          })
        )?.status;
        if (st === "SENDING" || st === "SENT") {
          return reply.send({ ok: true });
        }
        throw new AppError("VALIDATION_ERROR", { message: out.error });
      }
      return reply.send({ ok: true });
    }
  );

  app.post(
    "/drafts/:id/reject",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Reject a draft", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      const updated = await app.prisma.inboxDraft.updateMany({
        data: { status: "CANCELLED" },
        where: { id, status: { in: ["DRAFT", "PENDING"] } },
      });
      if (updated.count === 0) {
        throw new AppError("NOT_FOUND");
      }
      return reply.send({ ok: true });
    }
  );

  // Chat de staff mediado pela Cloud (Porta 1, §G) — as ferramentas
  // correm localmente com as permissões do utilizador autenticado.
  app.post(
    "/ai/reply",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "Cloud-mediated staff AI reply", tags: ["inbox"] },
    },
    async (req, reply) => {
      const settings = await assertInboxEnabled(app.prisma);
      const body = parse(aiReplySchema, req.body, req.locale);
      const token = settings.cloudShopTokenEncrypted
        ? decryptSecret(settings.cloudShopTokenEncrypted)
        : null;
      if (!(settings.cloudApiUrl && token)) {
        throw new AppError("CLOUD_UNREACHABLE");
      }
      const out = await askStaffAi(
        app.prisma,
        app.log,
        {
          apiUrl: settings.cloudApiUrl,
          token,
        },
        {
          messages: body.messages,
          userId: getUserId(req),
        }
      );
      return reply.send({ reply: out.reply });
    }
  );

  // Tokens MCP do próprio utilizador — proxy da Cloud (§G.9). A Cloud é
  // quem guarda e valida; a app só reencaminha com o userId da sessão.
  app.get(
    "/mcp/tokens",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "List own MCP tokens (Cloud proxy)", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const body = await mcpProxy(
        app.prisma,
        "GET",
        "/ai-inbox/tokens",
        getUserId(req)
      );
      return reply.send(body ?? { data: [] });
    }
  );

  app.post(
    "/mcp/tokens",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Create MCP token (Cloud proxy)", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const body = parse(mcpTokenCreateSchema, req.body, req.locale);
      const out = await mcpProxy(
        app.prisma,
        "POST",
        "/ai-inbox/tokens",
        getUserId(req),
        body
      );
      return reply.send(out ?? {});
    }
  );

  app.delete(
    "/mcp/tokens/:id",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Revoke MCP token (Cloud proxy)", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { id } = req.params as Params;
      await mcpProxy(
        app.prisma,
        "DELETE",
        `/ai-inbox/tokens/${encodeURIComponent(id)}`,
        getUserId(req)
      );
      return reply.send({ ok: true });
    }
  );

  // Preferências MCP do próprio utilizador — «permitir envio direto
  // pelo MCP» fica OFF por defeito e avisa que é arriscado (§G.5).
  app.get(
    "/mcp/preferences",
    {
      preHandler: [requirePermission({ inbox: ["view"] })],
      schema: { summary: "Own MCP preferences", tags: ["inbox"] },
    },
    async (req, reply) => {
      const user = await app.prisma.user.findUnique({
        select: { mcpDirectSend: true },
        where: { id: getUserId(req) },
      });
      return reply.send({ mcpDirectSend: user?.mcpDirectSend === true });
    }
  );

  app.put(
    "/mcp/preferences",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Set own MCP preferences", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const body = parse(mcpPrefsSchema, req.body, req.locale);
      await app.prisma.user.update({
        data: { mcpDirectSend: body.mcpDirectSend },
        where: { id: getUserId(req) },
      });
      return reply.send({ ok: true });
    }
  );

  // Endpoint manual da sweep de retenção — as Definições expõem o
  // valor; aqui corre-se a limpeza a pedido (também corre 1×/dia no
  // supervisor da ligação).
  app.post(
    "/retention/cleanup",
    {
      preHandler: [requirePermission({ inbox: ["manage"] })],
      schema: { summary: "Run inbox retention cleanup", tags: ["inbox"] },
    },
    async (_req, reply) => {
      await assertInboxEnabled(app.prisma);
      const removed = await cleanupInboxRetention(app.prisma, app.log);
      return reply.send({ removed });
    }
  );

  // Execução direta de uma ferramenta — usada pelo chat staff local
  // quando a Cloud pede via UI (modo sem link) e por testes.
  app.post(
    "/tools/:tool",
    {
      preHandler: [requirePermission({ inbox: ["send"] })],
      schema: { summary: "Run one staffInboxTool", tags: ["inbox"] },
    },
    async (req, reply) => {
      await assertInboxEnabled(app.prisma);
      const { tool } = req.params as { tool: string };
      const out = await runStaffInboxTool(app.prisma, app.log, {
        args: (req.body ?? {}) as Record<string, unknown>,
        tool,
        userId: getUserId(req),
      });
      if (out.error) {
        return reply.send({ error: out.error });
      }
      return reply.send({ result: out.result });
    }
  );
};
