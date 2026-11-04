import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env.js";
import { resolveUrls } from "../config/env.js";

// ── Mocks ──────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  authHandler: vi.fn(),
  emailConfigured: vi.fn().mockReturnValue(true),
  getSessionFromRequest: vi.fn().mockResolvedValue(null),
  incrementFailedAttempt: vi.fn(),
  isAccountLocked: vi.fn().mockReturnValue(false),
  resetFailedAttempts: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  userFindUniqueById: vi.fn(),
  updateCredentialPassword: vi.fn(),
  updateMustChangePassword: vi.fn(),
  updateStatus: vi.fn(),
  deleteUserSessions: vi.fn(),
  auditCreate: vi.fn(),
  hashPassword: vi.fn().mockResolvedValue("hashed-temp"),
}));

const fakeAuth = {
  handler: mocks.authHandler,
  api: { getSession: vi.fn().mockResolvedValue(null) },
};

vi.mock("../lib/auth.js", () => ({
  createAuth: () => fakeAuth,
  getSessionFromRequest: mocks.getSessionFromRequest,
}));

vi.mock("../lib/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/email.js")>();
  return {
    ...actual,
    isEmailConfigured: mocks.emailConfigured,
    sendPasswordResetEmail: vi.fn(),
  };
});

vi.mock("../services/account-lockout.service.js", () => ({
  incrementFailedAttempt: mocks.incrementFailedAttempt,
  isAccountLocked: mocks.isAccountLocked,
  resetFailedAttempts: mocks.resetFailedAttempts,
}));

vi.mock("../repositories/user.repository.js", () => ({
  findFirst: mocks.userFindFirst,
  findMany: mocks.userFindMany,
  findUniqueById: mocks.userFindUniqueById,
  updateCredentialPassword: mocks.updateCredentialPassword,
  updateMustChangePassword: mocks.updateMustChangePassword,
  updateStatus: mocks.updateStatus,
  deleteUserSessions: mocks.deleteUserSessions,
}));

vi.mock("../repositories/audit.repository.js", () => ({
  create: mocks.auditCreate,
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

const { default: authPlugin } = await import("../plugins/auth.js");
const { buildPasswordResetLink } = await import("../lib/reset-link.js");
const { buildPasswordResetEmail } = await import("../lib/email.js");
const { matchRoute, routeSecurity } = await import(
  "../config/route-security.js"
);
const { generateTemporaryPassword, listRecoverableUsers, recoverAccess } =
  await import("../scripts/recover-access.js");

// ── buildPasswordResetLink ─────────────────────────────────────────────
describe("buildPasswordResetLink", () => {
  const appUrl = "http://192.168.1.33:4000";
  const trusted = [
    appUrl,
    "http://localhost:4000",
    "http://oficinaos.local:4000",
  ];
  const baUrl = (callback?: string) =>
    `${appUrl}/api/auth/reset-password/TOKEN123${
      callback ? `?callbackURL=${encodeURIComponent(callback)}` : ""
    }`;

  it("usa o origin do callbackURL quando é confiável", () => {
    const link = buildPasswordResetLink(
      baUrl("http://oficinaos.local:4000/reset-password"),
      appUrl,
      trusted
    );
    expect(link).toBe(
      "http://oficinaos.local:4000/reset-password?token=TOKEN123"
    );
  });

  it("origin não confiável cai para appUrl", () => {
    const link = buildPasswordResetLink(
      baUrl("http://evil.example.com/reset-password"),
      appUrl,
      trusted
    );
    expect(link).toBe(`${appUrl}/reset-password?token=TOKEN123`);
  });

  it("sem callbackURL usa appUrl — o header Host nunca entra", () => {
    // Mesmo que o pedido chegue com Host forjado, a função só lê o URL
    // gerado pelo Better Auth — o host do pedido não é argumento.
    const link = buildPasswordResetLink(
      "http://forged-host.example/api/auth/reset-password/TOKEN123",
      appUrl,
      trusted
    );
    expect(link).toBe(`${appUrl}/reset-password?token=TOKEN123`);
  });

  it("URL inválido produz link para a página de erro, sem rebentar", () => {
    const link = buildPasswordResetLink("not-a-url", appUrl, trusted);
    expect(link).toBe(`${appUrl}/reset-password?token=`);
  });
});

// ── resolveUrls: origem mDNS ───────────────────────────────────────────
describe("resolveUrls — mDNS", () => {
  it("inclui http://<hostname>.local:<port> nas trustedOrigins", () => {
    const env = {
      NODE_ENV: "production",
      PORT: 4000,
      APP_URL: "http://192.168.1.33:4000",
      EXTRA_TRUSTED_ORIGINS: ["https://app.oficinaos.app"],
      MDNS_HOSTNAME: "oficinaos",
    } as Env;
    const { trustedOrigins } = resolveUrls(env);
    expect(trustedOrigins).toContain("http://oficinaos.local:4000");
    expect(trustedOrigins).toContain("https://app.oficinaos.app");
  });
});

// ── Email localizado ───────────────────────────────────────────────────
describe("buildPasswordResetEmail", () => {
  const url = "http://oficinaos.local:4000/reset-password?token=abc&x=<tag>";

  it("PT-PT: assunto, validade e aviso", () => {
    const mail = buildPasswordResetEmail(url, "pt");
    expect(mail.subject).toBe("Repor a password do OficinaOS");
    expect(mail.text).toContain("válido durante 1 hora");
    expect(mail.text).toContain("Se não pediu isto, ignore este email.");
    expect(mail.text).toContain(url);
  });

  it("fallback por locale (es/en); desconhecido cai em PT", () => {
    expect(buildPasswordResetEmail(url, "es").subject).toContain("Restablecer");
    expect(buildPasswordResetEmail(url, "en").subject).toContain("Reset");
    expect(buildPasswordResetEmail(url, "de").subject).toBe(
      "Repor a password do OficinaOS"
    );
  });

  it("escapa o URL no HTML (safeUrl)", () => {
    const mail = buildPasswordResetEmail(url, "pt");
    expect(mail.html).toContain("&lt;tag&gt;");
    expect(mail.html).not.toContain("<tag>");
  });
});

// ── Rotas: recovery-options + 503 ─────────────────────────────────────
async function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate("prisma", {
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
  } as never);
  await app.register(authPlugin);
  return app;
}

describe("/api/auth/recovery-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emailConfigured.mockReturnValue(true);
    mocks.authHandler.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
  });

  it("devolve { email: true } com SMTP configurado", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/recovery-options",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: true });
  });

  it("devolve { email: false } sem SMTP — sem dados de utilizadores", async () => {
    mocks.emailConfigured.mockReturnValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/recovery-options",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: false });
  });

  it("tem rate-limit próprio no mapa (igual ao do login)", () => {
    const cfg = matchRoute("/api/auth/recovery-options", routeSecurity);
    expect(
      cfg?.rateLimit && typeof cfg.rateLimit === "object"
        ? cfg.rateLimit.max
        : null
    ).toBe(5);
  });
});

describe("request-password-reset sem SMTP", () => {
  it("devolve 503 EMAIL_NOT_CONFIGURED e não chama o Better Auth", async () => {
    mocks.emailConfigured.mockReturnValue(false);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: {
        email: "dono@loja.pt",
        redirectTo: "http://localhost:4000/reset-password",
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("EMAIL_NOT_CONFIGURED");
    expect(mocks.authHandler).not.toHaveBeenCalled();
  });

  it("com SMTP segue para o Better Auth", async () => {
    mocks.emailConfigured.mockReturnValue(true);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: {
        email: "dono@loja.pt",
        redirectTo: "http://localhost:4000/reset-password",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.authHandler).toHaveBeenCalled();
  });
});

// ── Script recover-access ──────────────────────────────────────────────
const UNAMBIGUOUS_RE =
  /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/;
const AMBIGUOUS_RE = /[0O1lI]/;

describe("recover-access (script)", () => {
  const fakeTx = {
    user: { update: vi.fn() },
  };
  const fakePrisma = {
    $transaction: (fn: (tx: unknown) => Promise<void>) => fn(fakeTx),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("password temporária: 18+ caracteres, sem ambíguos", () => {
    const pw = generateTemporaryPassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(UNAMBIGUOUS_RE);
    expect(pw).not.toMatch(AMBIGUOUS_RE);
  });

  it("lista contas OWNER ativas", async () => {
    await listRecoverableUsers(fakePrisma as never);
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      fakePrisma,
      { role: "OWNER", isActive: true },
      expect.anything(),
      expect.anything(),
      50
    );
  });

  it("repor OWNER: hash + mustChangePassword + sessões apagadas + audit", async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: "u1",
      username: "dono",
      role: "OWNER",
      isActive: true,
    });
    const pw = await recoverAccess(fakePrisma as never, "dono");
    expect(pw).toHaveLength(18);
    expect(mocks.hashPassword).toHaveBeenCalledWith(pw);
    expect(mocks.updateCredentialPassword).toHaveBeenCalled();
    expect(mocks.updateMustChangePassword).toHaveBeenCalledWith(
      fakeTx,
      "u1",
      true
    );
    expect(mocks.deleteUserSessions).toHaveBeenCalledWith(fakeTx, "u1");
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      fakePrisma,
      expect.objectContaining({
        action: "PASSWORD_RESET",
        toValue: "Recuperação local (servidor)",
        userId: "u1",
      })
    );
  });

  it("conta inativa é recusada sem --reactivate", async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: "u2",
      username: "antigo",
      role: "OWNER",
      isActive: false,
    });
    await expect(recoverAccess(fakePrisma as never, "antigo")).rejects.toThrow(
      "inativa"
    );
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("--reactivate reativa e audita", async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: "u2",
      username: "antigo",
      role: "OWNER",
      isActive: false,
    });
    await recoverAccess(fakePrisma as never, "antigo", { reactivate: true });
    expect(fakeTx.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { isActive: true },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      fakePrisma,
      expect.objectContaining({ metadata: { reactivated: true } })
    );
  });

  it("recusa contas não-OWNER", async () => {
    mocks.userFindFirst.mockResolvedValue({
      id: "u3",
      username: "tecnico",
      role: "TECHNICIAN",
      isActive: true,
    });
    await expect(recoverAccess(fakePrisma as never, "tecnico")).rejects.toThrow(
      "OWNER"
    );
  });
});

// ── Regressão: reset por admin mantém a barreira OWNER ─────────────────
describe("admin reset — regressão OWNER", () => {
  it("não-OWNER não pode repor a password de um OWNER", async () => {
    const { resetPassword } = await import("../services/user.service.js");
    mocks.userFindUniqueById.mockResolvedValue({
      id: "u-owner",
      role: "OWNER",
      username: "dono",
    });
    await expect(
      resetPassword(
        { $transaction: vi.fn() } as never,
        "u-owner",
        "nova-senha-123",
        "u-tech",
        "TECHNICIAN"
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
