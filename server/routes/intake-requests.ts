import { IntakeRequestStatus } from "@generated/client";
import type { RoleType } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import type { PermissionCheck } from "@shared/permissions";
import { convertIntakeRequestSchema } from "@shared/schemas/intake-request.schema";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  convertIntakeRequest,
  dismissIntakeRequest,
  generateIntakeAiReport,
  generateIntakeQuoteSuggestion,
  listIntakeRequests,
} from "../services/intake-request.service.js";
import { resolveZodErrors } from "../utils/resolve-validation-messages.js";

const STATUS_VALUES = new Set<string>(Object.values(IntakeRequestStatus));

// O pré-orçamento lê nomes, preços e stock dos catálogos de peças e
// reparações — exige a mesma permissão das rotas /parts e /repairs
// (viewCatalog em ambos os recursos; requirePermission usa AND entre
// recursos). FRONT_DESK cria Jobs mas não tem acesso a catálogos.
const QUOTE_CATALOG_VIEW: PermissionCheck = {
  parts: ["viewCatalog"],
  repairs: ["viewCatalog"],
};

/** quoteSuggestion guarda nomes/preços/stock dos catálogos — só sai na
 * resposta para quem tem viewCatalog. A listagem já filtrava, mas as
 * ações (convert/dismiss/ai-report) devolvem a linha completa e expunham
 * o snapshot à receção (SEC #166). */
async function quoteCatalogAllowed(req: FastifyRequest): Promise<boolean> {
  if (!req.user) {
    return false;
  }
  const res = await req.server.auth.api.userHasPermission({
    body: {
      permissions: QUOTE_CATALOG_VIEW,
      role: req.user.role as RoleType,
    },
  });
  return res.success;
}

function visibleIntakeRequest<T extends { quoteSuggestion: unknown }>(
  row: T,
  catalogAllowed: boolean
): T {
  return catalogAllowed ? row : { ...row, quoteSuggestion: null };
}

// Staff-facing queue for the public pre-check form. Convert links the request
// to a job created through the normal intake modal — never creates jobs here.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const intakeRequestsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/",
    {
      preHandler: [requirePermission({ jobs: ["view"] })],
      schema: {
        querystring: {
          properties: { status: { type: "string" } },
          type: "object",
        },
        summary: "List intake requests",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { status } = req.query as { status?: string };
      if (status && !STATUS_VALUES.has(status)) {
        throw new AppError("VALIDATION_ERROR");
      }
      const requests = await listIntakeRequests(
        app.prisma,
        status as keyof typeof IntakeRequestStatus | undefined
      );
      // quoteSuggestion contém dados de catálogo (nomes/preços/stock) —
      // só sai na resposta para quem tem viewCatalog; sem isso o FRONT_DESK
      // leria o snapshot mesmo sem poder gerá-lo.
      const catalogAllowed = await quoteCatalogAllowed(req);
      return reply.send(
        requests.map((r) => visibleIntakeRequest(r, catalogAllowed))
      );
    }
  );

  app.post(
    "/:id/dismiss",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Dismiss a pending intake request",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await dismissIntakeRequest(app.prisma, id);
      return reply.send(
        visibleIntakeRequest(request, await quoteCatalogAllowed(req))
      );
    }
  );

  app.post(
    "/:id/convert",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        body: {
          properties: { jobId: { type: "string" } },
          required: ["jobId"],
          type: "object",
        },
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Link an intake request to its new job",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = convertIntakeRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", {
          errors: resolveZodErrors(
            parsed.error.flatten().fieldErrors,
            req.locale
          ),
        });
      }
      const request = await convertIntakeRequest(
        app.prisma,
        id,
        parsed.data.jobId
      );
      return reply.send(
        visibleIntakeRequest(request, await quoteCatalogAllowed(req))
      );
    }
  );

  // Shop-side Pro action: cloud generates the AI report with OUR paired token
  // (ai-reports module) — the customer never needs a token.
  app.post(
    "/:id/ai-report",
    {
      preHandler: [requirePermission({ jobs: ["create"] })],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Generate the AI diagnostic report via OficinaOS Cloud",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await generateIntakeAiReport(app.prisma, id, req.locale);
      return reply.send(
        visibleIntakeRequest(request, await quoteCatalogAllowed(req))
      );
    }
  );

  // Deterministic pre-quote from the diagnostic checks — advisory snapshot
  // stored on the request, never pre-fills a Job. Reads catalog names,
  // prices and stock, so it requires catalog view permission (not jobs:create
  // — FRONT_DESK can create jobs but must not see catalog data).
  app.post(
    "/:id/quote-suggestion",
    {
      preHandler: [requirePermission(QUOTE_CATALOG_VIEW)],
      schema: {
        params: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        summary: "Build the deterministic quote suggestion from the diagnostic",
        tags: ["intake-requests"],
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const request = await generateIntakeQuoteSuggestion(app.prisma, id);
      return reply.send(request);
    }
  );
};
