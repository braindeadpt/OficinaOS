import { AppError } from "@shared/errors/app-error.js";
import { preCheckSubmitSchema } from "@shared/schemas/intake-request.schema";
import { quoteRespondSchema } from "@shared/schemas/quote.schema";
import type { FastifyPluginAsync } from "fastify";
import { submitPreCheckRequest } from "../services/intake-request.service.js";
import { respondToQuote } from "../services/job-quote.service.js";
import { handleInboundSms } from "../services/sms.service.js";
import { codeLockout } from "../utils/code-lockout.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const JOB_CODE_RE = /^[A-Za-z0-9-]+$/;
const PHONE4_RE = /^\d{4}$/;

function parseQuoteRespondBody(body: unknown) {
  const raw = (body ?? {}) as Record<string, unknown>;
  const code = typeof raw.code === "string" ? raw.code : "";
  const phone4 = typeof raw.phone4 === "string" ? raw.phone4 : "";

  if (!(code && phone4)) {
    throw new AppError("MISSING_LOOKUP_PARAMS");
  }
  if (code.length > 50 || !JOB_CODE_RE.test(code)) {
    throw new AppError("INVALID_JOB_CODE");
  }
  if (!PHONE4_RE.test(phone4)) {
    throw new AppError("INVALID_PHONE4");
  }

  const parsed = quoteRespondSchema
    .pick({ quoteId: true, decision: true, note: true })
    .safeParse(raw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR");
  }

  return { code, phone4, ...parsed.data };
}

// Public customer endpoints. No auth — the code + last-4-phone-digits proof
// from /api/jobs/lookup is replayed here, with the same per-code lockout.
// Rate limit lives in config/route-security.ts (10 per 15 min, per IP).
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.post("/quote-respond", {
    schema: {
      tags: ["jobs"],
      summary: "Public quote response by code + phone4",
      body: {
        type: "object",
        required: ["code", "phone4", "quoteId", "decision"],
        properties: {
          code: { type: "string" },
          phone4: { type: "string" },
          quoteId: { type: "string" },
          decision: { type: "string" },
          note: { type: "string" },
        },
      },
    },
    handler: async (req, reply) => {
      const input = parseQuoteRespondBody(req.body);

      if (codeLockout.isLocked(input.code)) {
        throw new AppError("JOB_NOT_FOUND");
      }

      const result = await respondToQuote(app.prisma, input, {
        prisma: app.prisma,
        wsBroadcast: app.wsBroadcast,
      });

      if (!result.jobExists) {
        throw new AppError("JOB_NOT_FOUND");
      }
      // A phone miss must look identical to an unknown code — and it counts
      // toward the per-code lockout.
      if (result.error === "PHONE_MISMATCH") {
        codeLockout.trackFailure(input.code);
        throw new AppError("JOB_NOT_FOUND");
      }
      if (result.error) {
        throw new AppError(result.error);
      }

      codeLockout.clear(input.code);
      const quote = result.quote;
      return reply.send({
        id: quote?.id,
        version: quote?.version,
        amount: quote?.amount.toNumber(),
        note: quote?.note,
        status: quote?.status,
        sentAt: quote?.sentAt,
        respondedAt: quote?.respondedAt,
        responseNote: quote?.responseNote,
      });
    },
  });

  // Public pre-check form (and later the hosted Pro relay). Anonymous, so it
  // carries the strictest budget in route-security.ts. The `company` honeypot
  // is invisible to browsers — a filled value means a bot, which we reject
  // silently with a fake success instead of an error worth retrying.
  app.post("/pre-check", {
    handler: async (req, reply) => {
      const parsed = preCheckSubmitSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }

      if (parsed.data.company) {
        return reply.status(201).send({ ok: true });
      }

      const request = await submitPreCheckRequest(app.prisma, parsed.data, {
        prisma: app.prisma,
        wsBroadcast: app.wsBroadcast,
      });
      return reply.status(201).send({ code: request.code, id: request.id });
    },
    schema: {
      body: {
        properties: {
          company: { type: "string" },
          customerEmail: { type: "string" },
          customerName: { type: "string" },
          customerPhone: { type: "string" },
          deviceLabel: { type: "string" },
          problem: { type: "string" },
          scheduledFor: { type: "string" },
          whatsappOptIn: { type: "boolean" },
        },
        type: "object",
      },
      summary: "Submit a public pre-check request",
      tags: ["public"],
    },
  });

  /**
   * Webhook inbound do SMS Gateway (sms-gate) — o telemóvel na LAN faz
   * POST do envelope {event, payload:{sender, message}}. O segredo é o
   * próprio path: o gateway não suporta headers de auth, por isso o
   * :token gera-se ao ativar o módulo e nunca aparece na UI de terceiros.
   */
  app.post("/sms/inbound/:token", {
    handler: async (req, reply) => {
      const { token } = req.params as { token: string };
      const settings = await app.prisma.shopSettings.findUniqueOrThrow({
        where: { id: "default" },
      });
      // Token errado responde 404 — não dá pistas sobre a existência da rota.
      if (!(settings.smsEnabled && settings.smsWebhookToken === token)) {
        throw new AppError("NOT_FOUND");
      }
      const body = (req.body ?? {}) as {
        event?: string;
        payload?: { message?: string; phoneNumber?: string; sender?: string };
      };
      if (body.event === "sms:received") {
        const from = body.payload?.sender ?? body.payload?.phoneNumber;
        const text = body.payload?.message;
        if (from && text) {
          await handleInboundSms(
            app.prisma,
            app.log,
            { prisma: app.prisma, wsBroadcast: app.wsBroadcast },
            from,
            text
          );
        }
      }
      // Responde sempre 200 — o gateway repete o POST em erros e não nos
      // interessa revelar falhas de parsing a quem chama.
      return reply.send({ ok: true });
    },
    schema: {
      body: { type: "object", additionalProperties: true },
      params: {
        properties: { token: { type: "string" } },
        required: ["token"],
        type: "object",
      },
      summary: "Inbound SMS webhook from the local sms-gate device",
      tags: ["public"],
    },
  });
};
