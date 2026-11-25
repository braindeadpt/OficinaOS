import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canReplayStaffInboxTool,
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
  decryptSmsConfig: vi.fn(() => null),
  getOrCreateShopSettings: vi.fn(
    async (): Promise<Record<string, unknown>> => ({
      cloudEntitlements: ["ai-inbox"],
      cloudSyncedAt: new Date(),
      countryCode: "PT",
    })
  ),
  resolveWhatsAppChannel: vi.fn(() => ({ config: {}, mode: "local" })),
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
  decryptSmsConfig: mocks.decryptSmsConfig,
  sendSms: mocks.sendSms,
}));

vi.mock("../services/sms-cloud.service.js", () => ({
  isDefinitiveCloudError: () => true,
  sendSmsViaCloud: mocks.sendSmsViaCloud,
}));

vi.mock("../services/whatsapp-channel.js", () => ({
  resolveWhatsAppChannel: mocks.resolveWhatsAppChannel,
  sendWhatsAppText: mocks.sendWhatsAppText,
}));

vi.mock("../repositories/settings.repository.js", () => ({
  getOrCreateShopSettings: mocks.getOrCreateShopSettings,
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
      findFirst: vi.fn(async () => null),
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

  it("replay em cache só para conta ativa com permissão", async () => {
    const findUnique = vi.fn(async () => ({ ...TECH, active: false }));
    const prisma = fakePrisma({ user: { findUnique } });
    await expect(
      canReplayStaffInboxTool(prisma, "listar_conversas", "u-tech")
    ).resolves.toBe(false);
    findUnique.mockResolvedValueOnce({ ...TECH, active: true });
    await expect(
      canReplayStaffInboxTool(prisma, "listar_conversas", "u-tech")
    ).resolves.toBe(true);
    await expect(
      canReplayStaffInboxTool(prisma, "ferramenta_x", "u-tech")
    ).resolves.toBe(false);
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

  it("SENDING preso por restart volta a ser reclamável e envia", async () => {
    // Regressão Devin: crash entre o claim SENDING e o transporte deixava
    // o rascunho invisível na lista e o retry reportava "a enviar" para
    // sempre. O claim passa a aceitar SENDING stale (updatedAt velho).
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: new Date(),
          conversation: {
            channel: "whatsapp",
            id: "conv-1",
            lastInboundAt: new Date(),
            phone: "351912345678",
          },
          id: "draft-1",
          status: "SENDING",
          text: "x",
        })),
        update: vi.fn(async () => ({})),
        updateMany,
      },
    });
    const out = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(out.error).toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: "SENDING" }),
          ]),
        }),
      })
    );
  });

  it("SENDING stale com mensagem já gravada reconcilia para SENT sem reenviar", async () => {
    // Regressão Devin: restart entre recordOutboundMessage (externalId
    // "draft:<id>") e finalizar o rascunho — o retry não pode enviar uma
    // segunda vez nem o Reject um cancelamento falso.
    const update = vi.fn(async () => ({}));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const prisma = fakePrisma({
      businessMessage: {
        findFirst: vi.fn(async () => ({
          id: "m-sent-1",
          receivedAt: new Date("2026-01-01T10:00:00Z"),
        })),
        findMany: vi.fn(async () => []),
      },
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: new Date(),
          conversation: {
            channel: "whatsapp",
            id: "conv-1",
            lastInboundAt: new Date(),
            phone: "351912345678",
          },
          id: "draft-1",
          status: "SENDING",
          text: "x",
        })),
        update,
        updateMany,
      },
    });
    const out = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(out.error).toBeUndefined();
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
    // Sem isto o teste passava mesmo que a reconciliação não gravasse nada:
    // verifica a transição SENDING → SENT com o id e a data da mensagem.
    expect(updateMany).toHaveBeenCalledWith({
      data: {
        messageId: "m-sent-1",
        sentAt: new Date("2026-01-01T10:00:00Z"),
        status: "SENT",
      },
      where: { id: "draft-1", status: "SENDING" },
    });
  });

  it("abort durante o delay anti-ban reverte o claim e audita cancelado", async () => {
    const controller = new AbortController();
    mocks.resolveWhatsAppChannel.mockReturnValueOnce({
      config: {},
      mode: "evolution",
    } as never);
    mocks.sendViaEvolutionAntiBan.mockImplementationOnce(
      async (...args: unknown[]) => {
        const signal = args[6] as AbortSignal | undefined;
        if (!signal) {
          return { error: "signal em falta", success: false };
        }
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return { error: "cancelado", success: false };
      }
    );
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: null,
          approvedById: null,
          conversation: {
            channel: "whatsapp",
            id: "conv-1",
            lastInboundAt: new Date(),
            phone: "351912345678",
          },
          id: "draft-1",
          status: "PENDING",
          text: "x",
          updatedAt: new Date("2026-01-01T09:00:00Z"),
        })),
        update: vi.fn(async () => ({})),
        updateMany,
      },
      user: {
        findUnique: vi.fn(async () => ({ ...OWNER, mcpDirectSend: true })),
      },
    });
    const promise = runStaffInboxTool(prisma, log, {
      args: { rascunhoId: "draft-1" },
      signal: controller.signal,
      tool: "enviar_rascunho",
      userId: "u-owner",
    });
    await vi.waitFor(() =>
      expect(mocks.sendViaEvolutionAntiBan).toHaveBeenCalledTimes(1)
    );
    controller.abort();
    const out = await promise;
    expect(out.error).toBe("cancelado");
    // 1 = claim PENDING→SENDING; 2 = rollback para o estado pré-claim.
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1]?.[0]).toEqual({
      data: {
        approvedAt: null,
        approvedById: null,
        status: "PENDING",
        updatedAt: new Date("2026-01-01T09:00:00Z"),
      },
      where: { id: "draft-1", status: "SENDING" },
    });
    const toolAudit = mocks.createAuditLog.mock.calls.find(
      (c) =>
        ((c as unknown[])[1] as { action: string }).action === "INBOX_TOOL_CALL"
    );
    expect(toolAudit).toBeDefined();
    const metadata = (
      (toolAudit as unknown[])[1] as {
        metadata: { ok: boolean; outcome: string };
      }
    ).metadata;
    expect(metadata.ok).toBe(false);
    expect(metadata.outcome).toBe("cancelado");
  });

  it("abort depois do transporte arrancar não impede a finalização SENT", async () => {
    let finishSend: ((value: { success: boolean }) => void) | undefined;
    mocks.sendWhatsAppText.mockImplementationOnce(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          finishSend = resolve;
        })
    );
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: new Date(),
          approvedById: "u-owner",
          conversation: {
            channel: "whatsapp",
            id: "conv-1",
            lastInboundAt: new Date(),
            phone: "351912345678",
          },
          id: "draft-1",
          status: "PENDING",
          text: "x",
        })),
        update,
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const controller = new AbortController();
    const promise = sendApprovedDraft(
      prisma,
      log,
      "draft-1",
      "u-owner",
      false,
      controller.signal
    );
    await vi.waitFor(() =>
      expect(mocks.sendWhatsAppText).toHaveBeenCalledTimes(1)
    );
    controller.abort();
    finishSend?.({ success: true });
    const out = await promise;
    expect(out.error).toBeUndefined();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
        where: { id: "draft-1" },
      })
    );
  });

  it("SMS cloud usa dedupeId estável draft:<id> para retries do mesmo rascunho", async () => {
    mocks.getOrCreateShopSettings.mockResolvedValueOnce({
      cloudApiUrl: "https://cloud.example",
      cloudEntitlements: ["sms"],
      cloudShopTokenEncrypted: "enc:token",
      cloudSyncedAt: new Date(),
      countryCode: "PT",
    });
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: new Date(),
          approvedById: "u-owner",
          conversation: {
            channel: "sms",
            id: "conv-1",
            lastInboundAt: new Date(),
            phone: "351912345678",
          },
          id: "draft-1",
          status: "PENDING",
          text: "resposta por sms",
        })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const out = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(out.error).toBeUndefined();
    expect(mocks.sendSmsViaCloud).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: "https://cloud.example" }),
      expect.objectContaining({ dedupeId: "draft:draft-1" })
    );
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

  it("SMS com o módulo revogado não sai nem pelo gateway LAN (SEC #164)", async () => {
    // Gateway LAN configurado, mas o módulo sms NÃO está nos entitlements:
    // antes da correcção caía no fallback local e enviava na mesma.
    mocks.decryptSmsConfig.mockReturnValue({
      gatewayPassword: "p",
      gatewayUrl: "http://gw",
      gatewayUser: "u",
    } as never);
    const prisma = fakePrisma({
      inboxDraft: {
        findUnique: vi.fn(async () => ({
          approvedAt: new Date(),
          approvedById: null,
          conversation: {
            channel: "sms",
            id: "conv-1",
            lastInboundAt: new Date(),
            phone: "351912345678",
          },
          id: "draft-1",
          status: "PENDING",
          text: "resposta por sms",
        })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const out = await sendApprovedDraft(prisma, log, "draft-1", "u-owner");
    expect(out.error).toContain("módulo sms inativo");
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.sendSmsViaCloud).not.toHaveBeenCalled();
    mocks.decryptSmsConfig.mockReturnValue(null);
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
