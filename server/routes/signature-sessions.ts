import type { FastifyPluginAsync } from "fastify";
import { requirePermission } from "../middlewares/rbac.js";
import {
  createSignatureSession,
  getSignatureSession,
} from "../services/signature-session.service.js";

// Staff endpoints for the remote intake signature: create a short-lived
// session (its token becomes the QR the customer scans) and poll it until
// the signature lands. The public customer side lives in public.ts.
// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const signatureSessionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", {
    preHandler: [requirePermission({ jobs: ["create"] })],
    schema: {
      tags: ["signature-sessions"],
      summary: "Create a remote signature session (QR for /sign/:token)",
    },
    handler: async () => createSignatureSession(app.prisma),
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
};
