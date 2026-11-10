import { AppError } from "@shared/errors/app-error.js";
import { createSignatureSessionSchema } from "@shared/schemas/signature.schema.js";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  deleteSignatureRelay,
  publishSignatureRelay,
  REMOTE_SESSION_TTL_MS,
  remoteSignatureCreds,
} from "../services/signature-relay.service.js";
import {
  createSignatureSession,
  getSignatureSession,
  invalidateSignatureSession,
} from "../services/signature-session.service.js";

// Staff endpoints for the remote intake signature: create a short-lived
// session (its token becomes the QR the customer scans), poll it until the
// signature lands, and invalidate it when the ficha changes underneath —
// the frozen document is what the customer signs, so an edited ficha means
// a new link. The public customer side lives in public.ts.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const signatureSessionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", {
    preHandler: [requirePermission({ jobs: ["create"] })],
    schema: {
      tags: ["signature-sessions"],
      summary: "Create a remote signature session (QR for /sign/:token)",
    },
    handler: async (req) => {
      const parsed = createSignatureSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR");
      }
      // Pro signature-remote: the session also lives on the cloud so the
      // customer signs from anywhere — its longer TTL lets a late signature
      // still land on this local row via the poller.
      const relay = await remoteSignatureCreds(app.prisma);
      const session = await createSignatureSession(
        app.prisma,
        parsed.data.document,
        relay ? { ttlMs: REMOTE_SESSION_TTL_MS } : undefined
      );
      let cloudSignUrl: string | null = null;
      if (relay && parsed.data.document) {
        cloudSignUrl = await publishSignatureRelay(
          relay,
          {
            document: parsed.data.document,
            expiresAt: session.expiresAt,
            token: session.token,
          },
          req.log
        );
      }
      return { ...session, cloudSignUrl };
    },
  });

  app.get("/:token", {
    preHandler: [requirePermission({ jobs: ["create"] })],
    schema: {
      tags: ["signature-sessions"],
      summary: "Poll a signature session for the captured signature",
      params: {
        type: "object",
        properties: { token: { type: "string" } },
        required: ["token"],
      },
    },
    handler: (req) => {
      const { token } = req.params as { token: string };
      return getSignatureSession(app.prisma, token);
    },
  });

  app.post("/:token/invalidate", {
    preHandler: [requirePermission({ jobs: ["create"] })],
    schema: {
      tags: ["signature-sessions"],
      summary: "Invalidate a signature session whose ficha changed",
      params: {
        type: "object",
        properties: { token: { type: "string" } },
        required: ["token"],
      },
    },
    handler: async (req) => {
      const { token } = req.params as { token: string };
      const result = await invalidateSignatureSession(app.prisma, token);
      const relay = await remoteSignatureCreds(app.prisma);
      if (relay) {
        // Best effort — the local session is already gone; the cloud copy
        // also dies on its own expiresAt if this call doesn't reach it.
        deleteSignatureRelay(relay, token, req.log).catch(() => null);
      }
      return result;
    },
  });
};
