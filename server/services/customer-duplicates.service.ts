import type { PrismaClient } from "@generated/client";
import { effectiveDialCode } from "@shared/constants/countries.js";
import { AppError } from "@shared/errors/app-error.js";
import { normalizePhoneE164 } from "@shared/utils/phone";

/**
 * Possíveis duplicados por número de telefone (issue #77): clientes cujo
 * número normaliza para o mesmo E.164 — com o indicativo da loja por
 * omissão, o que apanha pares legados "912345678" vs "+351912345678".
 * Nada é alterado automaticamente: o relatório é informativo e a junção
 * é sempre manual, par a par, com auditoria.
 */

export interface DuplicateCustomerRow {
  createdAt: string;
  email: string | null;
  id: string;
  jobCount: number;
  name: string;
  normalizedPhone: string;
  phone: string;
  saleCount: number;
  taxId: string | null;
  whatsappConsent: boolean;
}

export interface DuplicateGroup {
  customers: DuplicateCustomerRow[];
  normalizedPhone: string;
}

export async function findDuplicateGroups(
  prisma: PrismaClient
): Promise<DuplicateGroup[]> {
  const settings = await prisma.shopSettings.findUnique({
    select: { countryCode: true },
    where: { id: "default" },
  });
  const dial = effectiveDialCode(settings?.countryCode);
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      _count: { select: { jobs: true, sales: true } },
      createdAt: true,
      email: true,
      id: true,
      name: true,
      phone: true,
      taxId: true,
      whatsappConsent: true,
    },
  });
  const groups = new Map<string, DuplicateCustomerRow[]>();
  for (const c of customers) {
    const normalizedPhone = normalizePhoneE164(c.phone, dial);
    const row: DuplicateCustomerRow = {
      createdAt: c.createdAt.toISOString(),
      email: c.email,
      id: c.id,
      jobCount: c._count.jobs,
      name: c.name,
      normalizedPhone,
      phone: c.phone,
      saleCount: c._count.sales,
      taxId: c.taxId,
      whatsappConsent: c.whatsappConsent,
    };
    const list = groups.get(normalizedPhone) ?? [];
    list.push(row);
    groups.set(normalizedPhone, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([normalizedPhone, list]) => ({ customers: list, normalizedPhone }));
}

/** O que a junção produz — devolvido na pré-visualização e na execução. */
export interface MergePreview {
  email: string | null;
  emailFrom: "keep" | "merged" | null;
  jobCount: number;
  keep: { id: string; name: string; phone: string };
  merged: { id: string; name: string; phone: string };
  saleCount: number;
  taxId: string | null;
  taxIdFrom: "keep" | "merged" | null;
  whatsappConsent: boolean;
}

function fieldSource(
  keepValue: string | null,
  mergedValue: string | null
): "keep" | "merged" | null {
  if (keepValue) {
    return "keep";
  }
  return mergedValue ? "merged" : null;
}

function buildPreview(
  keep: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    taxId: string | null;
    whatsappConsent: boolean;
  },
  merged: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    taxId: string | null;
    whatsappConsent: boolean;
  },
  counts: { jobs: number; sales: number }
): MergePreview {
  return {
    email: keep.email ?? merged.email,
    emailFrom: fieldSource(keep.email, merged.email),
    jobCount: counts.jobs,
    keep: { id: keep.id, name: keep.name, phone: keep.phone },
    merged: { id: merged.id, name: merged.name, phone: merged.phone },
    saleCount: counts.sales,
    taxId: keep.taxId ?? merged.taxId,
    taxIdFrom: fieldSource(keep.taxId, merged.taxId),
    whatsappConsent: keep.whatsappConsent || merged.whatsappConsent,
  };
}

const CUSTOMER_INCLUDE_COUNTS = {
  _count: { select: { jobs: true, sales: true } },
} as const;

export async function previewMerge(
  prisma: PrismaClient,
  keepId: string,
  mergedId: string
): Promise<MergePreview> {
  const [keep, merged] = await Promise.all([
    prisma.customer.findUnique({
      include: CUSTOMER_INCLUDE_COUNTS,
      where: { id: keepId },
    }),
    prisma.customer.findUnique({
      include: CUSTOMER_INCLUDE_COUNTS,
      where: { id: mergedId },
    }),
  ]);
  if (!(keep && merged)) {
    throw new AppError("NOT_FOUND", { resource: "customer" });
  }
  if (keep.id === merged.id) {
    throw new AppError("VALIDATION_ERROR", {
      message: "o cliente de destino e o juntado são o mesmo",
    });
  }
  return buildPreview(keep, merged, {
    jobs: keep._count.jobs + merged._count.jobs,
    sales: keep._count.sales + merged._count.sales,
  });
}

/**
 * Junção par a par: reatribui todo o histórico ao cliente de destino,
 * preenche campos vazios com os do juntado, apaga o juntado e regista a
 * auditoria. O número do juntado fica no metadata da auditoria — sem ele
 * não haveria rasto de que os dois números foram a mesma pessoa.
 */
export function mergeCustomers(
  prisma: PrismaClient,
  keepId: string,
  mergedId: string,
  userId: string
): Promise<MergePreview> {
  return prisma.$transaction(async (tx) => {
    const [keep, merged] = await Promise.all([
      tx.customer.findUnique({
        include: CUSTOMER_INCLUDE_COUNTS,
        where: { id: keepId },
      }),
      tx.customer.findUnique({
        include: CUSTOMER_INCLUDE_COUNTS,
        where: { id: mergedId },
      }),
    ]);
    if (!(keep && merged)) {
      throw new AppError("NOT_FOUND", { resource: "customer" });
    }
    if (keep.id === merged.id) {
      throw new AppError("VALIDATION_ERROR", {
        message: "o cliente de destino e o juntado são o mesmo",
      });
    }

    const preview = buildPreview(keep, merged, {
      jobs: keep._count.jobs + merged._count.jobs,
      sales: keep._count.sales + merged._count.sales,
    });

    // Reatribuir todo o histórico. O Supplier é 1:1 — só migra se o
    // destino ainda não for fornecedor; caso contrário fica órfão por
    // SetNull ao apagar, o que é preferível a perder a ficha de fornecedor.
    const relink = [
      tx.job.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.sale.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.tradeIn.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.purchaseOrder.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.supportTicket.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.businessMessage.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.inboxConversation.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
      tx.commercialAgreement.updateMany({
        data: { customerId: keepId },
        where: { customerId: mergedId },
      }),
    ];
    const keepSupplier = await tx.supplier.findUnique({
      where: { customerId: keepId },
    });
    if (!keepSupplier) {
      relink.push(
        tx.supplier.updateMany({
          data: { customerId: keepId },
          where: { customerId: mergedId },
        })
      );
    }
    await Promise.all(relink);

    // Preenche o que falta no destino; consentimento une-se (qualquer
    // opt-in vale, com a data mais antiga como prova).
    await tx.customer.update({
      data: {
        email: keep.email ?? merged.email,
        taxId: keep.taxId ?? merged.taxId,
        whatsappConsent: keep.whatsappConsent || merged.whatsappConsent,
        whatsappConsentAt:
          keep.whatsappConsent || merged.whatsappConsent
            ? ([keep.whatsappConsentAt, merged.whatsappConsentAt]
                .filter(Boolean)
                .sort()[0] ?? new Date())
            : null,
      },
      where: { id: keepId },
    });

    await tx.customer.delete({ where: { id: mergedId } });

    await tx.auditLog.create({
      data: {
        action: "CUSTOMER_MERGED",
        metadata: JSON.parse(
          JSON.stringify({
            keepPhone: keep.phone,
            mergedEmail: merged.email,
            mergedName: merged.name,
            mergedPhone: merged.phone,
            mergedTaxId: merged.taxId,
            preview,
          })
        ),
        note: `cliente «${merged.name}» (${merged.phone}) juntado a «${keep.name}» (${keep.phone})`,
        userId,
      },
    });

    return preview;
  });
}
