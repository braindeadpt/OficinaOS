import path from "node:path";
import staticPlugin from "@fastify/static";
import type { FastifyInstance } from "fastify";

// Uploads: served only through an authenticated pre-handler. The global
// authPlugin preHandler already rejects unauthenticated requests for anything
// not in its allow-list, so /api/uploads/** is session-gated.
// dotfiles:'deny' blocks every path whose segments start with '.' —
// send's default ('allow') would happily serve .secrets/analyst-ro.pass
// (the analyst DB password) to any logged-in technician.
// Only the folders the app itself writes are served: the Windows layouts
// keep the DB dumps (backups/) and heartbeats (backups-status/) inside
// UPLOAD_DIR, and anything else dropped there must stay private.
const SERVED_DIRS = new Set(["avatars", "job-photos"]);
const LEADING_SLASH = /^\/+/;

function isServedPath(pathName: string): boolean {
  const [top] = pathName.replace(LEADING_SLASH, "").split("/");
  return SERVED_DIRS.has(top ?? "");
}

export async function registerUploadsStatic(
  app: FastifyInstance,
  uploadDir: string
): Promise<void> {
  await app.register(staticPlugin, {
    root: path.resolve(uploadDir),
    prefix: "/api/uploads/",
    decorateReply: false,
    dotfiles: "deny",
    allowedPath: isServedPath,
  });
}
