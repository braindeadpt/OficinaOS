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
    whatsappConsentAt: null,
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
      $queryRaw: vi.fn().mockResolvedValue([]),
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      businessMessage: { updateMany: vi.fn().mockResolvedValue({}) },
      commercialAgreement: { updateMany: vi.fn().mockResolvedValue({}) },
      customer: {
        delete: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([
          {
            email: keep.email,
            id: "keep",
            lastRemarketingAt: null,
            phone: keep.phone,
            taxId: keep.taxId,
            whatsappConsent: keep.whatsappConsent,
            whatsappConsentAt: keep.whatsappConsentAt ?? null,
          },
          {
            email: merged.email,
            id: "gone",
            lastRemarketingAt: null,
            phone: merged.phone,
            taxId: merged.taxId,
            whatsappConsent: merged.whatsappConsent,
            whatsappConsentAt: merged.whatsappConsentAt ?? null,
          },
        ]),
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
    // O fixture tem conflito de consentimento (keep=false, merged=true) —
    // sem confirmConsent o resultado seria false; aqui confirma-se para o
    // teste se concentrar na reatribuição e nos campos vazios.
    const preview = await mergeCustomers(prisma, "keep", "gone", "user-1", {
      confirmConsent: true,
    });

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
    // A decisão final usa a releitura sob lock — o mock tem de devolver
    // as mesmas datas no findMany.
    tx.customer.findMany = vi.fn().mockResolvedValue([
      {
        email: null,
        id: "keep",
        lastRemarketingAt: older,
        phone: "+351912345678",
        taxId: null,
        whatsappConsent: false,
        whatsappConsentAt: null,
      },
      {
        email: null,
        id: "gone",
        lastRemarketingAt: newer,
        phone: "912345678",
        taxId: null,
        whatsappConsent: false,
        whatsappConsentAt: null,
      },
    ]);
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

  describe("consentimento WhatsApp na junção", () => {
    function consentPair(
      tx: ReturnType<typeof txMock>["tx"],
      keepConsent: { consent: boolean; at: Date | null },
      mergedConsent: { consent: boolean; at: Date | null }
    ) {
      tx.customer.findUnique = vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "keep"
            ? customerRow({
                id: "keep",
                phone: "+351912345678",
                whatsappConsent: keepConsent.consent,
                whatsappConsentAt: keepConsent.at,
              })
            : customerRow({
                id: "gone",
                phone: "912345678",
                whatsappConsent: mergedConsent.consent,
                whatsappConsentAt: mergedConsent.at,
              })
        )
      );
      // A decisão de consentimento relê-se com o lock, via findMany — o
      // mock tem de devolver os mesmos valores que o findUnique inicial.
      tx.customer.findMany = vi.fn().mockResolvedValue([
        {
          email: null,
          id: "keep",
          lastRemarketingAt: null,
          phone: "+351912345678",
          taxId: null,
          whatsappConsent: keepConsent.consent,
          whatsappConsentAt: keepConsent.at,
        },
        {
          email: null,
          id: "gone",
          lastRemarketingAt: null,
          phone: "912345678",
          taxId: null,
          whatsappConsent: mergedConsent.consent,
          whatsappConsentAt: mergedConsent.at,
        },
      ]);
    }

    function updateData(tx: ReturnType<typeof txMock>["tx"]) {
      return (
        tx.customer.update.mock.calls[0][0] as { data: Record<string, unknown> }
      ).data;
    }

    function auditConsent(tx: ReturnType<typeof txMock>["tx"]) {
      return (
        tx.auditLog.create.mock.calls[0][0] as {
          data: {
            metadata: {
              consent: {
                conflict: boolean;
                confirmedByUser: boolean;
                keep: boolean;
                merged: boolean;
                result: boolean;
              };
            };
          };
        }
      ).data.metadata.consent;
    }

    it("true + false sem confirmação → false, sem data, com os dois valores na auditoria", async () => {
      const { prisma, tx } = txMock();
      consentPair(
        tx,
        { consent: true, at: new Date("2025-01-01T00:00:00Z") },
        { consent: false, at: null }
      );
      const result = await mergeCustomers(prisma, "keep", "gone", "user-1");

      expect(updateData(tx).whatsappConsent).toBe(false);
      expect(updateData(tx).whatsappConsentAt).toBeNull();
      expect(result.whatsappConsent).toBe(false);
      expect(result.consentConflict).toBe(true);
      // A auditoria regista os dois valores originais e a decisão
      expect(auditConsent(tx)).toEqual({
        conflict: true,
        confirmedByUser: false,
        keep: true,
        merged: false,
        result: false,
      });
    });

    it("true + false com confirmConsent → true, com whatsappConsentAt = agora", async () => {
      const { prisma, tx } = txMock();
      consentPair(
        tx,
        { consent: true, at: new Date("2025-01-01T00:00:00Z") },
        { consent: false, at: null }
      );
      const before = Date.now();
      const result = await mergeCustomers(prisma, "keep", "gone", "user-1", {
        confirmConsent: true,
      });

      expect(updateData(tx).whatsappConsent).toBe(true);
      const consentAt = updateData(tx).whatsappConsentAt as Date;
      expect(consentAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(consentAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(result.whatsappConsent).toBe(true);
      expect(auditConsent(tx)).toEqual({
        conflict: true,
        confirmedByUser: true,
        keep: true,
        merged: false,
        result: true,
      });
    });

    it("true + true → true, com a data mais antiga como prova", async () => {
      const { prisma, tx } = txMock();
      const oldest = new Date("2024-03-10T00:00:00Z");
      const newest = new Date("2025-11-20T00:00:00Z");
      consentPair(
        tx,
        { consent: true, at: newest },
        { consent: true, at: oldest }
      );
      await mergeCustomers(prisma, "keep", "gone", "user-1");

      expect(updateData(tx).whatsappConsent).toBe(true);
      expect(updateData(tx).whatsappConsentAt).toEqual(oldest);
      expect(auditConsent(tx)).toEqual({
        conflict: false,
        confirmedByUser: false,
        keep: true,
        merged: true,
        result: true,
      });
    });

    it("false + false → false, sem conflito nem data", async () => {
      const { prisma, tx } = txMock();
      consentPair(
        tx,
        { consent: false, at: null },
        { consent: false, at: null }
      );
      await mergeCustomers(prisma, "keep", "gone", "user-1");

      expect(updateData(tx).whatsappConsent).toBe(false);
      expect(updateData(tx).whatsappConsentAt).toBeNull();
      expect(auditConsent(tx).conflict).toBe(false);
    });

    it("retirada de consentimento a meio da junção é respeitada na releitura sob lock", async () => {
      const { prisma, tx } = txMock();
      // Leitura inicial: ambos com consentimento. Até ao lock, o cliente
      // retira o consentimento na ficha que morre (PARAR por SMS) — a
      // decisão tem de usar o valor fresco, não o inicial.
      consentPair(
        tx,
        { consent: true, at: new Date("2025-01-01T00:00:00Z") },
        { consent: true, at: new Date("2025-02-01T00:00:00Z") }
      );
      tx.customer.findMany = vi.fn().mockResolvedValue([
        {
          email: null,
          id: "keep",
          lastRemarketingAt: null,
          phone: "+351912345678",
          taxId: null,
          whatsappConsent: true,
          whatsappConsentAt: new Date("2025-01-01T00:00:00Z"),
        },
        {
          email: null,
          id: "gone",
          lastRemarketingAt: null,
          phone: "912345678",
          taxId: null,
          whatsappConsent: false,
          whatsappConsentAt: null,
        },
      ]);
      await mergeCustomers(prisma, "keep", "gone", "user-1");

      // true + false sem confirmação → conflito, consentimento desligado.
      expect(updateData(tx).whatsappConsent).toBe(false);
      expect(updateData(tx).whatsappConsentAt).toBeNull();
      expect(auditConsent(tx).conflict).toBe(true);
      expect(auditConsent(tx).merged).toBe(false);
    });

    it("correção do telefone a meio da junção aborta antes de apagar", async () => {
      const { prisma, tx } = txMock();
      consentPair(
        tx,
        { consent: false, at: null },
        { consent: false, at: null }
      );
      // Alguém corrige o telefone da ficha que morre antes do lock — o
      // par deixa de ser duplicado e a junção não pode continuar.
      tx.customer.findMany = vi.fn().mockResolvedValue([
        {
          email: null,
          id: "keep",
          lastRemarketingAt: null,
          phone: "+351912345678",
          taxId: null,
          whatsappConsent: false,
          whatsappConsentAt: null,
        },
        {
          email: null,
          id: "gone",
          lastRemarketingAt: null,
          phone: "913999888",
          taxId: null,
          whatsappConsent: false,
          whatsappConsentAt: null,
        },
      ]);
      await expect(
        mergeCustomers(prisma, "keep", "gone", "user-1")
      ).rejects.toThrow();
      expect(tx.customer.delete).not.toHaveBeenCalled();
    });

    it("pré-visualização assinala o conflito e mostra o resultado seguro", async () => {
      const { previewMerge } = await import("../customer-duplicates.service");
      const prisma = {
        customer: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve(
              where.id === "keep"
                ? customerRow({
                    _count: { jobs: 1, sales: 0 },
                    id: "keep",
                    phone: "+351912345678",
                    whatsappConsent: true,
                    whatsappConsentAt: new Date("2025-01-01T00:00:00Z"),
                  })
                : customerRow({
                    _count: { jobs: 0, sales: 2 },
                    id: "gone",
                    phone: "912345678",
                    whatsappConsent: false,
                    whatsappConsentAt: null,
                  })
            )
          ),
        },
        shopSettings: {
          findUnique: vi.fn().mockResolvedValue({ countryCode: "PT" }),
        },
      } as unknown as PrismaClient;

      const preview = await previewMerge(prisma, "keep", "gone");
      expect(preview.consentConflict).toBe(true);
      // Resultado seguro: sem confirmação do operador, o consentimento fica desligado
      expect(preview.whatsappConsent).toBe(false);
    });

    it("pré-visualização sem conflito mantém o valor comum", async () => {
      const { previewMerge } = await import("../customer-duplicates.service");
      const prisma = {
        customer: {
          findUnique: vi.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve(
              where.id === "keep"
                ? customerRow({
                    _count: { jobs: 0, sales: 0 },
                    id: "keep",
                    phone: "+351912345678",
                    whatsappConsent: true,
                  })
                : customerRow({
                    _count: { jobs: 0, sales: 0 },
                    id: "gone",
                    phone: "912345678",
                    whatsappConsent: true,
                  })
            )
          ),
        },
        shopSettings: {
          findUnique: vi.fn().mockResolvedValue({ countryCode: "PT" }),
        },
      } as unknown as PrismaClient;

      const preview = await previewMerge(prisma, "keep", "gone");
      expect(preview.consentConflict).toBe(false);
      expect(preview.whatsappConsent).toBe(true);
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
