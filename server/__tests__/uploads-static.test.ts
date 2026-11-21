/**
 * /api/uploads/** is session-gated by the global auth preHandler — but
 * authentication alone is not enough: send's default dotfiles:'allow'
 * served <UPLOAD_DIR>/.secrets/analyst-ro.pass (the analyst DB password)
 * to any logged-in technician. The uploads static must deny dot-segments
 * while normal files keep working.
 *
 * This harness registers the REAL registerUploadsStatic (the same code
 * index.ts runs) over a temp UPLOAD_DIR — the requests below simulate a
 * caller that already passed the session check upstream.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerUploadsStatic } from "../lib/uploads-static.js";

const SECRET = "test-secret-never-served";
const DUMP = "oficinaos-20261121-033000.sql.gz";
const uploadDir = mkdtempSync(join(tmpdir(), "uploads-static-it-"));
let app: FastifyInstance;

beforeAll(async () => {
  mkdirSync(join(uploadDir, ".secrets"), { recursive: true });
  mkdirSync(join(uploadDir, "job-photos"), { recursive: true });
  writeFileSync(join(uploadDir, ".secrets", "analyst-ro.pass"), SECRET);
  writeFileSync(join(uploadDir, ".hidden"), "dotfile");
  mkdirSync(join(uploadDir, "backups"), { recursive: true });
  mkdirSync(join(uploadDir, "backups-status"), { recursive: true });
  mkdirSync(join(uploadDir, "avatars"), { recursive: true });
  writeFileSync(join(uploadDir, "backups", DUMP), SECRET);
  writeFileSync(
    join(uploadDir, "backups-status", "last-backup.txt"),
    "2026-11-21T03:30:00Z"
  );
  writeFileSync(join(uploadDir, "stray.txt"), SECRET);
  writeFileSync(join(uploadDir, "avatars", "u1.png"), "png");
  writeFileSync(
    join(uploadDir, "job-photos", "photo.jpg"),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
  );

  app = Fastify({ logger: false });
  await registerUploadsStatic(app, uploadDir);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("uploads static — dotfiles denied", () => {
  it("GET /api/uploads/.secrets/analyst-ro.pass → 403, never the content", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/uploads/.secrets/analyst-ro.pass",
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain(SECRET);
  });

  it("dotfiles at the root are denied too", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/uploads/.hidden",
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain("dotfile");
  });

  it("a normal file keeps being served", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/uploads/job-photos/photo.jpg",
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("missing files still 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/uploads/job-photos/missing.jpg",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("uploads static — only app-written folders are served", () => {
  it.each([
    `/api/uploads/backups/${DUMP}`,
    "/api/uploads/backups-status/last-backup.txt",
    "/api/uploads/stray.txt",
    `/api/uploads/job-photos/../backups/${DUMP}`,
    `/api/uploads/job-photos/%2e%2e/backups/${DUMP}`,
    `/api/uploads//backups/${DUMP}`,
    `/api/uploads/BACKUPS/${DUMP}`,
  ])("GET %s is refused without leaking content", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain("2026-11-21T03:30:00Z");
  });

  it("avatars keep being served", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/uploads/avatars/u1.png",
    });
    expect(res.statusCode).toBe(200);
  });
});
