import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import securityPlugin, {
  isEmbedPath,
  parseOriginList,
} from "../plugins/security.js";

describe("isEmbedPath", () => {
  it.each(["/embed", "/embed/", "/embed/pre-check"])("matches %s", (path) => {
    expect(isEmbedPath(path)).toBe(true);
  });

  it.each([
    "/embedxyz",
    "/embedded",
    "/api/embed",
    "/foo/embed/x",
    "/embe",
  ])("does not match %s", (path) => {
    expect(isEmbedPath(path)).toBe(false);
  });
});

describe("parseOriginList", () => {
  it("returns [] for empty input", () => {
    expect(parseOriginList(null)).toEqual([]);
    expect(parseOriginList("")).toEqual([]);
    expect(parseOriginList("   \n  ")).toEqual([]);
  });

  it("canonicalizes one origin per line and dedupes", () => {
    expect(
      parseOriginList(
        "https://loja.pt/path?x=1\nhttp://lan:4000, https://loja.pt"
      )
    ).toEqual(["https://loja.pt", "http://lan:4000"]);
  });

  it("drops invalid and non-http(s) entries", () => {
    expect(
      parseOriginList("notaurl\nftp://x.pt\njavascript:alert(1)\nhttps://ok.pt")
    ).toEqual(["https://ok.pt"]);
  });
});

async function buildApp(embedAllowedOrigins?: string | null) {
  const app = Fastify();
  app.decorate("prisma", {
    shopSettings: {
      findUnique: vi.fn(async () =>
        embedAllowedOrigins === undefined ? null : { embedAllowedOrigins }
      ),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  } as never);
  await app.register(securityPlugin);
  app.get("/embed/pre-check", async () => ({ ok: true }));
  app.get("/embed-malicious", async () => ({ ok: true }));
  app.get("/dashboard", async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("embed CSP / X-Frame-Options", () => {
  it("allows any site to frame /embed/* when no origins are configured", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/embed/pre-check" });
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors *"
    );
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });

  it("restricts frame-ancestors to the configured origins", async () => {
    const app = await buildApp("https://loja.pt\nhttps://site.com");
    const res = await app.inject({ method: "GET", url: "/embed/pre-check" });
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors https://loja.pt https://site.com"
    );
    expect(res.headers["content-security-policy"]).not.toContain(
      "frame-ancestors *"
    );
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });

  it("keeps normal pages clickjacking-protected", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/dashboard" });
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'"
    );
    expect(res.headers["x-frame-options"]).toBeDefined();
  });

  it("does not treat a sibling path like /embed-malicious as embeddable", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/embed-malicious" });
    expect(res.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'"
    );
    expect(res.headers["x-frame-options"]).toBeDefined();
  });
});
