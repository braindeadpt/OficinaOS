import { describe, expect, it, vi } from "vitest";
import type { BotToolCtx } from "../bot-tools.js";
import { runBotTool } from "../bot-tools.js";

const log = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
} as never;

const OWN_CODE = "REP-2024-000001-AAA";
const OTHER_CODE = "REP-2024-000001-BBB";

const viewJob = {
  accessCode: "tok",
  color: null,
  depositAmount: null,
  device: { brand: { name: "Apple" }, model: "iPhone 12" },
  estimatedCost: { toNumber: () => 100 },
  estimatedDate: new Date(Date.now() + 86_400_000),
  externalRepairs: [],
  hasLoanerDevice: false,
  jobCode: OWN_CODE,
  loanerReturnedAt: null,
  notes: [],
  partsUsed: [],
  partsWaiting: [],
  payments: [],
  portalPublishedAt: null,
  quotes: [],
  repairs: [{ price: { toNumber: () => 100 } }],
  status: "IN_REPAIR",
  warrantyForJobId: null,
};

function makeCtx(jobs: { id: string; jobCode: string }[] = []): {
  ctx: BotToolCtx;
  prisma: Record<string, unknown>;
} {
  const prisma = {
    job: {
      findFirst: vi.fn(({ where }: { where: { jobCode: string } }) => {
        const hit = jobs.find((j) => j.jobCode === where.jobCode);
        return Promise.resolve(hit ? { id: hit.id } : null);
      }),
      findMany: vi.fn(() => Promise.resolve([])),
      findUnique: vi.fn(() => Promise.resolve(viewJob)),
    },
  };
  const ctx: BotToolCtx = {
    currency: "EUR",
    customerIds: ["cust-1"],
    log,
    portalApiUrl: null,
    portalEnabled: false,
    prisma: prisma as never,
    shopCard: {
      botAvgRepairDaysAfterPart: 2,
      botInfoText: "Aberto 09:00-18:00. Rua X, 12.",
    },
  };
  return { ctx, prisma };
}

describe("bot tools scoping", () => {
  it("ver_detalhe returns the view for the caller's own job", async () => {
    const { ctx } = makeCtx([{ id: "j1", jobCode: OWN_CODE }]);
    const res = await runBotTool(ctx, "ver_detalhe", { codigo: OWN_CODE });
    const view = res.result as { codigo?: string; erro?: string };
    expect(view.codigo).toBe(OWN_CODE);
    expect(view.erro).toBeUndefined();
  });

  it("ver_detalhe of another customer's REP code returns not found", async () => {
    const { ctx } = makeCtx([{ id: "j1", jobCode: OWN_CODE }]);
    // OTHER_CODE exists in "the DB" but belongs to cust-2 — findFirst scoped
    // to customerIds returns null, so the tool reports not found.
    const res = await runBotTool(ctx, "ver_detalhe", { codigo: OTHER_CODE });
    expect(res.result).toEqual({ erro: "nao_encontrado" });
  });

  it("ver_detalhe rejects malformed codes without querying", async () => {
    const { ctx, prisma } = makeCtx();
    const res = await runBotTool(ctx, "ver_detalhe", {
      codigo: "'; DROP TABLE jobs;--",
    });
    expect(res.result).toEqual({ erro: "nao_encontrado" });
    expect(
      (prisma.job as { findFirst: ReturnType<typeof vi.fn> }).findFirst
    ).not.toHaveBeenCalled();
  });

  it("ver_orcamento of another customer's job returns not found", async () => {
    const { ctx } = makeCtx();
    const res = await runBotTool(ctx, "ver_orcamento", { codigo: OTHER_CODE });
    expect(res.result).toEqual({ erro: "nao_encontrado" });
  });

  it("info_loja returns the shop card fields only", async () => {
    const { ctx } = makeCtx();
    const res = await runBotTool(ctx, "info_loja", {});
    expect(res.result).toEqual({
      diasMediosReparacaoAposPeca: 2,
      info: "Aberto 09:00-18:00. Rua X, 12.",
    });
  });

  it("pedir_humano flags escalation", async () => {
    const { ctx } = makeCtx();
    const res = await runBotTool(ctx, "pedir_humano", { motivo: "frustrado" });
    expect(res.escalate).toBe(true);
  });

  it("unknown tools are refused", async () => {
    const { ctx } = makeCtx();
    const res = await runBotTool(ctx, "drop_all_tables", {});
    expect(res.result).toEqual({ erro: "ferramenta_desconhecida" });
  });
});
