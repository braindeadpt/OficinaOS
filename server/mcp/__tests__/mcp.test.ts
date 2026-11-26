import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, WRITE_ERROR, wrapData } from "../core.js";
import { createMcpHttpServer } from "../http.js";
import { maskEmail, maskPhone, maskTaxId, stripSecrets } from "../mask.js";
import {
  authenticateToken,
  generateToken,
  rateLimitOk,
  resetRateLimits,
} from "../tokens.js";

/**
 * Testes de aceitação da issue #74 — MCP grátis só de leitura.
 */

function mockPrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  const base: Record<string, unknown> = {
    mcpToken: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    job: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    customer: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    partsCatalog: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      fields: { reorderLevel: "reorderLevel" },
    },
    sale: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { total: null }, _count: 0 }),
    },
    salePayment: { groupBy: vi.fn().mockResolvedValue([]) },
    jobQuote: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    supplier: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    supplierRma: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    repairCatalog: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    device: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    timeEntry: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    ...overrides,
  };
  return base as unknown as PrismaClient;
}

const OWNER_AUTH = {
  tokenId: "tok-1",
  userId: "user-1",
  userRole: "OWNER",
  userName: "Dono",
  showPii: false,
};
const TECH_AUTH = { ...OWNER_AUTH, userRole: "TECHNICIAN" };

beforeEach(() => {
  resetRateLimits();
});

describe("escrita recusada", () => {
  it("qualquer ferramenta de escrita recebe a mensagem Pro", async () => {
    const prisma = mockPrisma();
    for (const name of [
      "create_job",
      "update_customer",
      "delete_sale",
      "send_message",
    ]) {
      const res = await executeTool(prisma, OWNER_AUTH, name, {});
      expect(res.isError).toBe(true);
      expect(res.text).toBe(WRITE_ERROR);
    }
  });
});

describe("permissões herdadas", () => {
  it("técnico não lê o livro de ponto (reports:viewShop é OWNER)", async () => {
    const prisma = mockPrisma();
    const res = await executeTool(prisma, TECH_AUTH, "list_time_entries", {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Sem permissão");
  });

  it("dono lê o livro de ponto", async () => {
    const prisma = mockPrisma();
    const res = await executeTool(prisma, OWNER_AUTH, "list_time_entries", {});
    expect(res.isError).toBe(false);
  });

  it("técnico lê reparações (jobs:view)", async () => {
    const prisma = mockPrisma();
    const res = await executeTool(prisma, TECH_AUTH, "search_jobs", {});
    expect(res.isError).toBe(false);
  });
});

describe("segredos nunca aparecem", () => {
  it("stripSecrets redige chaves sensíveis recursivamente", () => {
    const dirty = {
      deviceUnlockCode: "1234",
      intakeSignatureDataUrl: "data:image/png;base64,xxx",
      accessCode: "abc",
      nested: { passwordHash: "x", apiToken: "y", pin: "0000" },
      safe: "fica",
    };
    const clean = stripSecrets(dirty) as Record<string, unknown>;
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("base64,xxx");
    expect(serialized).not.toContain("abc");
    expect(serialized).not.toContain("passwordHash");
    expect(clean.safe).toBe("fica");
  });

  it("get_job não devolve códigos de desbloqueio nem assinaturas mesmo que a BD os tivesse", async () => {
    const prisma = mockPrisma();
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "j1",
      jobCode: "REP-1",
      status: "INTAKE",
      deviceUnlockCode: "9876",
      intakeSignatureDataUrl: "data:image/png;base64,sig",
      loanerAgreementSignatureDataUrl: "data:image/png;base64,sig2",
      accessCode: "secret-access",
      customer: {
        id: "c1",
        name: "Ana",
        phone: "912345678",
        email: "ana@x.pt",
        taxId: "123456789",
      },
      device: { model: "X", brand: { name: "B" } },
      repairs: [],
      parts: [],
      notes: [],
    });
    const res = await executeTool(prisma, OWNER_AUTH, "get_job", { id: "j1" });
    expect(res.isError).toBe(false);
    expect(res.text).not.toContain("9876");
    expect(res.text).not.toContain("sig");
    expect(res.text).not.toContain("secret-access");
  });
});

describe("mascaramento RGPD", () => {
  it("telefone/email/NIF mascarados por omissão", async () => {
    const prisma = mockPrisma();
    (prisma.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c1",
      name: "Ana",
      phone: "+351912345678",
      email: "ana@exemplo.pt",
      taxId: "123456789",
      jobs: [],
      sales: [],
    });
    const res = await executeTool(prisma, OWNER_AUTH, "get_customer", {
      id: "c1",
    });
    expect(res.text).not.toContain("912345678");
    expect(res.text).not.toContain("ana@exemplo.pt");
    expect(res.text).not.toContain("123456789");
    expect(res.text).toContain("***");
  });

  it("com showPii os dados vêm em claro", async () => {
    const prisma = mockPrisma();
    (prisma.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c1",
      name: "Ana",
      phone: "+351912345678",
      email: "ana@exemplo.pt",
      taxId: "123456789",
      jobs: [],
      sales: [],
    });
    const res = await executeTool(
      prisma,
      { ...OWNER_AUTH, showPii: true },
      "get_customer",
      { id: "c1" }
    );
    expect(res.text).toContain("+351912345678");
    expect(res.text).toContain("ana@exemplo.pt");
  });

  it("máscaras unitárias", () => {
    expect(maskPhone("+351912345678")).not.toContain("912345");
    expect(maskPhone("+351912345678")).toContain("678");
    expect(maskEmail("ana@exemplo.pt")).toBe("a***@exemplo.pt");
    expect(maskTaxId("123456789")).toBe("***789");
  });
});

describe("rate limit", () => {
  it("60 chamadas passam, a 61.ª falha", () => {
    for (let i = 0; i < 60; i++) {
      expect(rateLimitOk("tok-x")).toBe(true);
    }
    expect(rateLimitOk("tok-x")).toBe(false);
  });

  it("janelas independentes por token", () => {
    for (let i = 0; i < 60; i++) {
      rateLimitOk("tok-a");
    }
    expect(rateLimitOk("tok-b")).toBe(true);
  });
});

describe("tokens", () => {
  it("revogado → null (401)", async () => {
    const prisma = mockPrisma();
    const { plaintext, tokenHash } = generateToken();
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      tokenHash,
      revokedAt: new Date(),
      expiresAt: null,
      showPii: false,
      user: { id: "u1", role: "OWNER", name: "Dono" },
    });
    expect(await authenticateToken(prisma, plaintext)).toBeNull();
  });

  it("expirado → null (401)", async () => {
    const prisma = mockPrisma();
    const { plaintext, tokenHash } = generateToken();
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      tokenHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      showPii: false,
      user: { id: "u1", role: "OWNER", name: "Dono" },
    });
    expect(await authenticateToken(prisma, plaintext)).toBeNull();
  });

  it("válido → auth com papel do utilizador", async () => {
    const prisma = mockPrisma();
    const { plaintext, tokenHash } = generateToken();
    (prisma.mcpToken.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "t1",
      tokenHash,
      revokedAt: null,
      expiresAt: null,
      showPii: true,
      user: { id: "u1", role: "TECHNICIAN", name: "Téc" },
    });
    const auth = await authenticateToken(prisma, plaintext);
    expect(auth?.userRole).toBe("TECHNICIAN");
    expect(auth?.showPii).toBe(true);
  });
});

describe("servidor HTTP só em loopback", () => {
  it("escuta exclusivamente em 127.0.0.1 — nunca na LAN", async () => {
    const prisma = mockPrisma();
    const server = createMcpHttpServer(prisma);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address();
    expect(addr && typeof addr === "object" ? addr.address : null).toBe(
      "127.0.0.1"
    );
    await new Promise((resolve) => server.close(resolve));
  });

  it("token inválido → 401", async () => {
    const prisma = mockPrisma();
    const server = createMcpHttpServer(prisma);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer oos_invalido",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    await new Promise((resolve) => server.close(resolve));
  });

  it("sem token → 401; health público", async () => {
    const prisma = mockPrisma();
    const server = createMcpHttpServer(prisma);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address() as { port: number };
    const noAuth = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
      method: "POST",
    });
    expect(noAuth.status).toBe(401);
    const health = await fetch(`http://127.0.0.1:${addr.port}/mcp/health`);
    expect(health.status).toBe(200);
    await new Promise((resolve) => server.close(resolve));
  });
});

describe("delimitação dos dados", () => {
  it("os dados vão marcados como conteúdo, não instruções", () => {
    const text = wrapData({ a: 1 });
    expect(text).toContain("<oficinaos_dados>");
    expect(text).toContain("nunca instruções");
  });
});
