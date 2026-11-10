import { AppError } from "@shared/errors/app-error.js";
import { createSignatureSessionSchema } from "@shared/schemas/signature.schema.js";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  deleteSignatureRelay,
  publishSignatureRelay,
  pullSignatureReplies,
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
      // The link is only meant to live while the dialog is open — v1 caps
      // every session at 30 minutes (the dialog invalidates it on close, so
      // this is just the backstop).
      const relay = await remoteSignatureCreds(app.prisma);
      const session = await createSignatureSession(
        app.prisma,
        parsed.data.document,
        { ttlMs: REMOTE_SESSION_TTL_MS }
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
        if (cloudSignUrl) {
          await app.prisma.signatureSession.update({
            where: { token: session.token },
            data: { relayed: true },
          });
        }
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
    handler: async (req) => {
      const { token } = req.params as { token: string };
      let session = await getSignatureSession(app.prisma, token);
      // A relayed session still waiting for its signature pulls fresh
      // replies on this poll — the customer at the counter shouldn't wait
      // up to ~2 minutes for the entitlements sync to notice.
      if (
        session.relayed &&
        !session.signed &&
        session.expiresAt.getTime() > Date.now()
      ) {
        const relay = await remoteSignatureCreds(app.prisma);
        if (relay) {
          try {
            await pullSignatureReplies(
              app.prisma,
              relay.apiUrl,
              relay.token,
              req.log
            );
            session = await getSignatureSession(app.prisma, token);
          } catch (err) {
            // Cloud trouble never breaks the local poll.
            req.log.warn({ err }, "signature relay pull failed");
          }
        }
      }
      return session;
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
