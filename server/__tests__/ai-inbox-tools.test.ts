import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runStaffInboxTool,
  sendApprovedDraft,
} from "../services/staff-inbox-tools.js";

/**
 * staffInboxTools (§G.3/§G.5/§G.8): resumo_cliente sem PIN/IMEI/
 * unlockCode, rascunho nunca envia, envio só após aprovação e uma vez,
 * AuditLog em TODAS as chamadas.
 */

const mocks = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => undefined),
  sendSms: vi.fn(async () => ({ success: true })),
  sendSmsViaCloud: vi.fn(async () => ({ success: true })),
  sendViaEvolutionAntiBan: vi.fn(async () => ({ success: true })),
  sendWhatsAppText: vi.fn(async () => ({ success: true })),
}));

vi.mock("../services/audit.service.js", () => ({
  createAuditLog: mocks.createAuditLog,
}));

vi.mock("../services/evolution-bot.service.js", () => ({
  evolutionConfigFor: vi.fn(() => ({
    apiKey: "k",
    baseUrl: "http://evo",
    instance: "oficinaos",
  })),
  sendViaEvolutionAntiBan: mocks.sendViaEvolutionAntiBan,
}));

vi.mock("../services/inbox.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/inbox.service.js")
  >("../services/inbox.service.js");
  return {
    ...actual,
    markConversationRead: vi.fn(async () => undefined),
    recordOutboundMessage: vi.fn(async () => ({
      conversationId: "conv-1",
      created: true,
      messageId: "m-out-1",
    })),
  };
});

vi.mock("../services/sms.service.js", () => ({
  decryptSmsConfig: vi.fn(() => null),
  sendSms: mocks.sendSms,
}));

vi.mock("../services/sms-cloud.service.js", () => ({
  isDefinitiveCloudError: () => true,
  sendSmsViaCloud: mocks.sendSmsViaCloud,
}));

vi.mock("../services/whatsapp-channel.js", () => ({
  resolveWhatsAppChannel: vi.fn(() => ({ config: {}, mode: "local" })),
  sendWhatsAppText: mocks.sendWhatsAppText,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: vi.fn(async () => ({
    cloudEntitlements: ["ai-inbox"],
    cloudSyncedAt: new Date(),
    countryCode: "PT",
  })),
}));

vi.mock("../lib/crypto.js", () => ({
  decryptSecret: vi.fn((v: string) => `dec:${v}`),
}));

const log = { error: vi.fn(), warn: vi.fn() } as never;

const OWNER = {
  active: true,
  id: "u-owner",
  mcpDirectSend: false,
  name: "Dona",
  role: "OWNER",
};

const TECH = {
  active: true,
  id: "u-tech",
  mcpDirectSend: false,
  name: "Tec",
  role: "TECHNICIAN",
};

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const p: Record<string, unknown> = {
    businessMessage: {
      findMany: vi.fn(async () => []),
    },
    customer: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => ({
        createdAt: new Date(),
        email: "a@b.c",
        id: "c1",
        name: "Ana",
        phone: "917755333",
      })),
    },
    inboxConversation: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "conv-1"
          ? {
              channel: "whatsapp",
              id: "conv-1",
              lastInboundAt: new Date(),
              phone: "351912345678",
            }
          : null
      ),
      update: vi.fn(async () => ({})),
    },
    inboxDraft: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "draft-1",
        ...data,
      })),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    job: { findMany: vi.fn(async () => []) },
    user: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        if (where.id === "u-owner") {
          return Promise.resolve(OWNER);
        }
        if (where.id === "u-tech") {
          return Promise.resolve(TECH);
        }
        return Promise.resolve({ active: true, name: "X" });
      }),
    },
    ...overrides,
  };
  return p as never;
}

beforeEach(() => vi.clearAllMocks());

describe("resumo_cliente — §G.8 allowlist", () => {
  it("nunca devolve PIN/IMEI/unlockCode — o select nem os pede", async () => {
    const jobFindMany = vi.fn(async () => [
      {
        // O que a DB devolveria se o select fosse errado — o teste falha
        // se estes campos aparecerem no resultado final.
        accessCode: "5X71",
        deviceUnlockCode: "QZ88",
        imei: "354567890777777",
        jobCode: "REP-2024-000001-ABC",
        status: "IN_REPAIR",
        createdAt: new Date(),
        device: { brand: { name: "Apple" }, model: "iPhone 12" },
        estimatedDate: null,
        payments: [{ amount: 50 }],
        quotes: [],
      },
    ]);
    const prisma = fakePrisma({
      job: { findMany: jobFindMany },
    });
    const out = await runStaffInboxTool(prisma, log, {
      args: { customerId: "c1" },
      tool: "resumo_cliente",
      userId: "u-owner",
    });
    expect(out.error).toBeUndefined();
    const json = JSON.stringify(out.result);
    expect(json).not.toContain("QZ88");
    expect(json).not.toContain("5X71");
    expect(json).not.toContain("354567890777777");
    // O select NÃO pede os campos sensíveis — allowlist, não blocklist.
    const select = (
      (jobFindMany.mock.calls[0] as unknown[])[0] as {
        select: Record<string, unknown>;
      }
    ).select;
    const selectKeys = JSON.stringify(select);
    for (const bad of ["imei", "deviceUnlockCode", "accessCode", "pin"]) {
      expect(selectKeys).not.toContain(bad);
    }
    expect(json).toContain("REP-2024-000001-ABC");
    expect(json).toContain("iPhone 12");
  });
});

describe("rascunhar_resposta / enviar_rascunho — §G.5", () => {
  it("rascunhar_resposta cria rascunho PENDING e NUNCA envia", async () => {
    const prisma = fakePrisma();
    const out = await runStaffInboxTool(prisma, log, {
      args: { conversaId: "conv-1", texto: "Olá, a reparação está pronta." },
      tool: "rascunhar_resposta",
      userId: "u-owner",
    });
    expect(out.error).toBeUndefined();
    expect(
      (out.result as { aguarda_aprovacao: boolean }).aguarda_aprovacao
    ).toBe(true);
    const created = (
      (
        prisma as never as {
          inboxDraft: { create: ReturnType<typeof vi.fn> };
        }
      ).inboxDraft.create.mock.calls[0] as unknown[]
    )[0] as {
      data: { status: string };
    };
    expect(created.data.status).toBe("PENDING");
    // Nenhum transporte foi tocado.
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.sendViaEvolutionAntiBan).not.toHaveBeenCalled();
  });

  it("conta desativada perde acesso mesmo com role válido (token MCP antigo)", async () => {
    const prisma = fakePrisma({
      user: {
        findUnique: vi.fn(async () => ({ ...TECH, active: false })),
      },
    });
    const out = await runStaffInboxTool(prisma, log, {
      args: {},
      tool: "listar_conversas",
      userId: "u-tech",
    });
    expect(out.error).toBe("conta desativada");
  });

  it("envio concorrente perde a claim — não há segundo transporte", async () => {
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: new Date(),
          conversation: {
            channel: "whatsapp",
            id: "conv-1",
            phone: "351912345678",
          },
          id: "draft-1",
          status: "PENDING",
          text: "x",
        })),
        update: vi.fn(async () => ({})),
        // Outro pedido ganhou a transição DRAFT/PENDING→SENDING.
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });
    const out = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(out.error).toBe("rascunho já está a ser enviado");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("enviar_rascunho sem aprovação e sem mcpDirectSend → aguarda aprovação", async () => {
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: null,
          status: "PENDING",
        })),
      },
    });
    const out = await runStaffInboxTool(prisma, log, {
      args: { rascunhoId: "draft-1" },
      tool: "enviar_rascunho",
      userId: "u-owner",
    });
    expect(out.error).toBe("aguarda aprovação humana na aplicação");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("rascunho aprovado envia UMA vez — segunda chamada não reenvia", async () => {
    const draftState = {
      approvedAt: new Date(),
      approvedById: null,
      conversation: {
        channel: "whatsapp",
        id: "conv-1",
        lastInboundAt: new Date(), // dentro da janela de 24h
        phone: "351912345678",
      },
      id: "draft-1",
      status: "PENDING",
      text: "mensagem aprovada",
    };
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({ ...draftState })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const r1 = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(r1.error).toBeUndefined();
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    // Segunda chamada: draft já SENT → não reenvia.
    (
      prisma as never as {
        inboxDraft: { findUnique: ReturnType<typeof vi.fn> };
      }
    ).inboxDraft.findUnique.mockResolvedValue({
      ...draftState,
      status: "SENT",
    });
    const r2 = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect((r2.result as { ja_enviado: boolean }).ja_enviado).toBe(true);
    expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1);
    // Audit INBOX_MESSAGE_SENT gravado no envio.
    const sentAudit = mocks.createAuditLog.mock.calls.find(
      (c) =>
        ((c as unknown[])[1] as { action: string }).action ===
        "INBOX_MESSAGE_SENT"
    );
    expect(sentAudit).toBeDefined();
  });

  it("sendApprovedDraft sem approvedAt → recusa", async () => {
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: null,
          conversation: { channel: "whatsapp", id: "conv-1", phone: "351" },
          id: "draft-1",
          status: "PENDING",
          text: "x",
        })),
      },
    });
    const out = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(out.error).toBe("aguarda aprovação humana na aplicação");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });
});

describe("audit e RBAC", () => {
  it("TODA a chamada cria AuditLog INBOX_TOOL_CALL sem conteúdo de mensagem", async () => {
    const prisma = fakePrisma();
    await runStaffInboxTool(prisma, log, {
      args: { conversaId: "conv-1", texto: "segredo do cliente" },
      tool: "rascunhar_resposta",
      userId: "u-owner",
    });
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(1);
    const entry = (mocks.createAuditLog.mock.calls[0] as unknown[])[1] as {
      action: string;
      metadata: { args: Record<string, unknown>; tool: string };
      userId: string;
    };
    expect(entry.action).toBe("INBOX_TOOL_CALL");
    expect(entry.userId).toBe("u-owner");
    expect(entry.metadata.tool).toBe("rascunhar_resposta");
    // O texto da resposta NÃO vai para o audit — só o comprimento.
    expect(JSON.stringify(entry.metadata.args)).not.toContain(
      "segredo do cliente"
    );
  });

  it("ferramenta desconhecida audita-se na mesma e falha", async () => {
    const prisma = fakePrisma();
    const out = await runStaffInboxTool(prisma, log, {
      args: {},
      tool: "apagar_tudo",
      userId: "u-owner",
    });
    expect(out.error).toContain("desconhecida");
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(1);
  });

  it("TECHNICIAN não pode atribuir (inbox:manage é OWNER/FRONT_DESK)", async () => {
    const prisma = fakePrisma();
    const out = await runStaffInboxTool(prisma, log, {
      args: { conversaId: "conv-1", utilizadorId: "u-tech" },
      tool: "atribuir",
      userId: "u-tech",
    });
    expect(out.error).toBe("sem permissão para atribuir");
    // Mesmo sem permissão o audit corre — tentativas ficam registadas.
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(1);
  });
});
