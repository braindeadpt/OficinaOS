import type { PrismaClient } from "@generated/client";
import { describe, expect, it, vi } from "vitest";
import {
  findDuplicateGroups,
  mergeCustomers,
} from "../customer-duplicates.service";

function customerRow(over: Record<string, unknown>) {
  return {
    _count: { jobs: 0, sales: 0 },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    email: null,
    id: "c1",
    name: "Cliente",
    phone: "912345678",
    taxId: null,
    whatsappConsent: false,
    ...over,
  };
}

function mockPrisma(rows: unknown[]) {
  return {
    customer: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
    shopSettings: {
      findUnique: vi.fn().mockResolvedValue({ countryCode: "PT" }),
    },
  } as unknown as PrismaClient;
}

describe("findDuplicateGroups", () => {
  it("junta «912345678» com «+351 912 345 678» no mesmo grupo", async () => {
    const prisma = mockPrisma([
      customerRow({ id: "c1", phone: "912345678" }),
      customerRow({ id: "c2", phone: "+351 912 345 678" }),
      customerRow({ id: "c3", phone: "00351912345678" }),
    ]);
    const groups = await findDuplicateGroups(prisma);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.normalizedPhone).toBe("+351912345678");
    expect(groups[0]?.customers.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("número estrangeiro não colide com o nacional pelos mesmos dígitos finais", async () => {
    const prisma = mockPrisma([
      customerRow({ id: "c1", phone: "912345678" }),
      customerRow({ id: "c2", phone: "+44912345678" }),
    ]);
    const groups = await findDuplicateGroups(prisma);
    expect(groups).toHaveLength(0);
  });

  it("sem pares não há grupos", async () => {
    const prisma = mockPrisma([
      customerRow({ id: "c1", phone: "912345678" }),
      customerRow({ id: "c2", phone: "913456789" }),
    ]);
    expect(await findDuplicateGroups(prisma)).toHaveLength(0);
  });
});

describe("mergeCustomers", () => {
  function txMock() {
    const keep = customerRow({
      email: "keep@x.pt",
      id: "keep",
      name: "Manter",
      phone: "+351912345678",
      whatsappConsent: false,
    });
    const merged = customerRow({
      email: null,
      id: "gone",
      name: "Juntar",
      phone: "912345678",
      taxId: "123456789",
      whatsappConsent: true,
      whatsappConsentAt: new Date("2025-01-01T00:00:00Z"),
    });
    const tx = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      businessMessage: { updateMany: vi.fn().mockResolvedValue({}) },
      commercialAgreement: { updateMany: vi.fn().mockResolvedValue({}) },
      customer: {
        delete: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === "keep" ? keep : merged)
        ),
        update: vi.fn().mockResolvedValue({}),
      },
      inboxConversation: { updateMany: vi.fn().mockResolvedValue({}) },
      job: { updateMany: vi.fn().mockResolvedValue({}) },
      notificationOutbox: { updateMany: vi.fn().mockResolvedValue({}) },
      shopSettings: {
        findUnique: vi.fn().mockResolvedValue({ countryCode: "PT" }),
      },
      purchaseOrder: { updateMany: vi.fn().mockResolvedValue({}) },
      sale: { updateMany: vi.fn().mockResolvedValue({}) },
      supplier: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({}),
      },
      supportTicket: { updateMany: vi.fn().mockResolvedValue({}) },
      tradeIn: { updateMany: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient;
    return { prisma, tx };
  }

  it("reatribui o histórico, preenche campos vazios, apaga e audita", async () => {
    const { prisma, tx } = txMock();
    const preview = await mergeCustomers(prisma, "keep", "gone", "user-1");

    expect(tx.job.updateMany).toHaveBeenCalledWith({
      data: { customerId: "keep" },
      where: { customerId: "gone" },
    });
    expect(tx.sale.updateMany).toHaveBeenCalled();
    expect(tx.tradeIn.updateMany).toHaveBeenCalled();
    expect(tx.customer.delete).toHaveBeenCalledWith({ where: { id: "gone" } });

    // NIF veio do juntado; email ficou o do destino
    const updateArgs = tx.customer.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.taxId).toBe("123456789");
    expect(updateArgs.data.email).toBe("keep@x.pt");
    expect(updateArgs.data.whatsappConsent).toBe(true);

    // Auditoria com os dois números — rasto do que foi juntado
    const audit = tx.auditLog.create.mock.calls[0][0] as {
      data: {
        action: string;
        metadata: { mergedPhone: string };
        userId: string;
      };
    };
    expect(audit.data.action).toBe("CUSTOMER_MERGED");
    expect(audit.data.metadata.mergedPhone).toBe("912345678");
    expect(audit.data.userId).toBe("user-1");
    expect(preview.jobCount).toBe(0);
  });

  it("recusa juntar o cliente consigo mesmo", async () => {
    const { prisma } = txMock();
    await expect(
      mergeCustomers(prisma, "keep", "keep", "user-1")
    ).rejects.toThrow();
  });
  it("recusa a junção se os telefones entretanto deixaram de coincidir", async () => {
    const { prisma, tx } = txMock();
    tx.customer.findUnique = vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === "keep"
          ? customerRow({ id: "keep", phone: "+351912345678" })
          : customerRow({ id: "gone", phone: "+351967654321" })
      )
    );
    await expect(
      mergeCustomers(prisma, "keep", "gone", "user-1")
    ).rejects.toThrow();
    expect(tx.customer.delete).not.toHaveBeenCalled();
    expect(tx.job.updateMany).not.toHaveBeenCalled();
  });

  it("mantém a data de campanha mais recente e repõe o telefone da fila", async () => {
    const { prisma, tx } = txMock();
    const newer = new Date("2026-06-01T00:00:00Z");
    const older = new Date("2026-01-01T00:00:00Z");
    tx.customer.findUnique = vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === "keep"
          ? customerRow({
              id: "keep",
              lastRemarketingAt: older,
              phone: "+351912345678",
            })
          : customerRow({
              id: "gone",
              lastRemarketingAt: newer,
              phone: "912345678",
            })
      )
    );
    await mergeCustomers(prisma, "keep", "gone", "user-1");
    const updateArgs = tx.customer.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.lastRemarketingAt).toEqual(newer);
    expect(tx.notificationOutbox.updateMany).toHaveBeenCalledWith({
      data: { recipientPhone: "+351912345678" },
      where: { recipientPhone: "912345678", status: "QUEUED" },
    });
  });

  describe("migração da auditoria", () => {
    it("é apenas aditiva — nenhum dado de clientes é alterado", async () => {
      const fs = await import("node:fs");
      const sql = fs.readFileSync(
        "prisma/migrations/20261231209000_customer_merged_audit_action/migration.sql",
        "utf8"
      );
      expect(sql).toContain("ADD VALUE");
      const upper = sql.toUpperCase();
      expect(upper.includes("UPDATE ")).toBe(false);
      expect(upper.includes("DELETE ")).toBe(false);
      expect(upper.includes("DROP ")).toBe(false);
      expect(upper.includes("ALTER TABLE")).toBe(false);
    });
  });
});
