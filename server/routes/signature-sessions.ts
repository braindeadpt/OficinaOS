import { AppError } from "@shared/errors/app-error.js";
import { createSignatureSessionSchema } from "@shared/schemas/signature.schema.js";
import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  deleteSignatureRelay,
  pairingSignatureCreds,
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
      // LAN-only sessions keep the default 15-minute expiry. The 30-minute
      // remote TTL only applies when the cloud actually accepted the relay —
      // otherwise an unpaired/offline shop would silently get longer links.
      const relay = await remoteSignatureCreds(app.prisma);
      const session = await createSignatureSession(
        app.prisma,
        parsed.data.document
      );
      let cloudSignUrl: string | null = null;
      if (relay && parsed.data.document) {
        // Cloud link and local session must expire together — the reply
        // lands back on this same session through the poller.
        const remoteExpiresAt = new Date(Date.now() + REMOTE_SESSION_TTL_MS);
        cloudSignUrl = await publishSignatureRelay(
          relay,
          {
            document: parsed.data.document,
            expiresAt: remoteExpiresAt,
            token: session.token,
          },
          req.log
        );
        if (cloudSignUrl) {
          await app.prisma.signatureSession.update({
            where: { token: session.token },
            data: { relayed: true, expiresAt: remoteExpiresAt },
          });
          session.expiresAt = remoteExpiresAt;
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
      // Pairing creds, not module-gated: a lost entitlement must not orphan
      // the cloud copy — it would keep serving the document until expiry.
      const relay = await pairingSignatureCreds(app.prisma);
      if (relay) {
        // Best effort — the local session is already gone; the cloud copy
        // also dies on its own expiresAt if this call doesn't reach it.
        deleteSignatureRelay(relay, token, req.log).catch(() => null);
      }
      return result;
    },
  });
};
