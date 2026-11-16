import path from "node:path";
import staticPlugin from "@fastify/static";
import type { FastifyInstance } from "fastify";

// Uploads: served only through an authenticated pre-handler. The global
// authPlugin preHandler already rejects unauthenticated requests for anything
// not in its allow-list, so /api/uploads/** is session-gated.
// dotfiles:'deny' blocks every path whose segments start with '.' —
// send's default ('allow') would happily serve .secrets/analyst-ro.pass
// (the analyst DB password) to any logged-in technician.
export async function registerUploadsStatic(
  app: FastifyInstance,
  uploadDir: string
): Promise<void> {
  await app.register(staticPlugin, {
    root: path.resolve(uploadDir),
    prefix: "/api/uploads/",
    decorateReply: false,
    dotfiles: "deny",
  });
}
