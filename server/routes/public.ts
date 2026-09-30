import { AppError } from "@shared/errors/app-error.js";
import { quoteRespondSchema } from "@shared/schemas/quote.schema";
import type { FastifyPluginAsync } from "fastify";
import { respondToQuote } from "../services/job-quote.service.js";
import { codeLockout } from "../utils/code-lockout.js";

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
};
