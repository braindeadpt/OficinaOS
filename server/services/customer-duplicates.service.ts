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
  consentConflict: boolean;
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

/**
 * Consentimento WhatsApp na junção: não existe registo de retirada (STOP),
 * logo unir com OR pode reativar alguém que o retirou na ficha que morre.
 * Regra conservadora: valores iguais mantêm-se; conflito desliga, a não
 * ser que o operador confirme com o cliente (`confirmConsent`).
 */
export function resolveMergeConsent(
  keep: { whatsappConsent: boolean; whatsappConsentAt: Date | null },
  merged: { whatsappConsent: boolean; whatsappConsentAt: Date | null },
  confirmConsent = false
): { consent: boolean; consentAt: Date | null; conflict: boolean } {
  const conflict = keep.whatsappConsent !== merged.whatsappConsent;
  if (!conflict) {
    if (!keep.whatsappConsent) {
      return { consent: false, consentAt: null, conflict };
    }
    // A data mais antiga é a prova do opt-in — ordenação cronológica
    // explícita (o sort() por omissão compara strings, não datas).
    const oldest = [keep.whatsappConsentAt, merged.whatsappConsentAt]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return { consent: true, consentAt: oldest ?? new Date(), conflict };
  }
  if (confirmConsent) {
    // Confirmação nova junto do cliente — a prova é o momento da junção.
    return { consent: true, consentAt: new Date(), conflict };
  }
  return { consent: false, consentAt: null, conflict };
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
    whatsappConsentAt: Date | null;
  },
  merged: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    taxId: string | null;
    whatsappConsent: boolean;
    whatsappConsentAt: Date | null;
  },
  counts: { jobs: number; sales: number }
): MergePreview {
  // A pré-visualização não sabe se o operador vai confirmar — mostra o
  // resultado seguro (conflito desliga) e assinala o conflito ao painel.
  const consent = resolveMergeConsent(keep, merged, false);
  return {
    consentConflict: consent.conflict,
    email: keep.email ?? merged.email,
    emailFrom: fieldSource(keep.email, merged.email),
    jobCount: counts.jobs,
    keep: { id: keep.id, name: keep.name, phone: keep.phone },
    merged: { id: merged.id, name: merged.name, phone: merged.phone },
    saleCount: counts.sales,
    taxId: keep.taxId ?? merged.taxId,
    taxIdFrom: fieldSource(keep.taxId, merged.taxId),
    whatsappConsent: consent.consent,
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
  await assertPhonesStillMatch(prisma, keep.phone, merged.phone);
  return buildPreview(keep, merged, {
    jobs: keep._count.jobs + merged._count.jobs,
    sales: keep._count.sales + merged._count.sales,
  });
}

/**
 * O par só é elegível enquanto os dois telefones normalizam para o mesmo
 * E.164. Corre no merge (dentro da transação) e na pré-visualização, para
 * o erro chegar antes da confirmação e não só depois dela.
 */
type DbLike = Pick<PrismaClient, "shopSettings">;

async function assertPhonesStillMatch(
  prisma: DbLike,
  keepPhone: string,
  mergedPhone: string
): Promise<void> {
  const settings = await prisma.shopSettings.findUnique({
    select: { countryCode: true },
    where: { id: "default" },
  });
  const dial = effectiveDialCode(settings?.countryCode);
  if (
    normalizePhoneE164(keepPhone, dial) !==
    normalizePhoneE164(mergedPhone, dial)
  ) {
    throw new AppError("VALIDATION_ERROR", {
      message:
        "os telefones já não coincidem — recarrega o relatório de duplicados",
    });
  }
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
  userId: string,
  opts?: { confirmConsent?: boolean }
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

    // O relatório pode estar aberto há dias: se entretanto alguém corrigiu
    // um dos telefones, o par já não é duplicado e juntar apagava uma ficha
    // de outra pessoa. Verifica dentro da transação, nunca confia no painel.
    await assertPhonesStillMatch(tx, keep.phone, merged.phone);

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

    // Mensagens ainda na fila com o telefone literal do juntado passam a
    // apontar para o número mantido — caso contrário a verificação de
    // consentimento na próxima tentativa não encontrava a ficha.
    await tx.notificationOutbox.updateMany({
      data: { recipientPhone: keep.phone },
      where: { recipientPhone: merged.phone, status: "QUEUED" },
    });

    // Preenche o que falta no destino. O consentimento NÃO se une com OR:
    // sem registo de retirada, um «true» herdado podia reativar quem
    // respondeu STOP na ficha que morre — ver resolveMergeConsent. A data
    // da última campanha de remarketing é a MAIS RECENTE das duas —
    // perdê-la faria o agendador voltar a contactar o número antes do
    // prazo da loja.
    // Lock tardio das duas fichas, só antes de escrever: cedo demais
    // invertia a ordem de locks com a caixa de entrada (que tranca a
    // conversa e depois referencia a ficha) e arriscava deadlock. Assim
    // a ordem fica coerente com o resto da app — reatribuições primeiro,
    // ficha no fim. O consentimento relê-se já com o lock, porque outro
    // operador pode ter registado/retirado opt-in desde a leitura inicial
    // (um PARAR por SMS, por exemplo) e a decisão tem de respeitar o valor
    // mais recente. Ordem por id contra deadlocks entre duas junções.
    const lockOrder = [keepId, mergedId].sort();
    for (const lockId of lockOrder) {
      await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${lockId} FOR UPDATE`;
    }
    const freshRows = await tx.customer.findMany({
      select: {
        id: true,
        whatsappConsent: true,
        whatsappConsentAt: true,
      },
      where: { id: { in: [keepId, mergedId] } },
    });
    const freshKeep = freshRows.find((r) => r.id === keepId);
    const freshMerged = freshRows.find((r) => r.id === mergedId);
    if (!(freshKeep && freshMerged)) {
      throw new AppError("NOT_FOUND", { resource: "customer" });
    }
    const consent = resolveMergeConsent(
      freshKeep,
      freshMerged,
      opts?.confirmConsent === true
    );
    const lastRemarketing = [keep.lastRemarketingAt, merged.lastRemarketingAt]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    await tx.customer.update({
      data: {
        email: keep.email ?? merged.email,
        ...(lastRemarketing ? { lastRemarketingAt: lastRemarketing } : {}),
        taxId: keep.taxId ?? merged.taxId,
        whatsappConsent: consent.consent,
        whatsappConsentAt: consent.consentAt,
      },
      where: { id: keepId },
    });

    await tx.customer.delete({ where: { id: mergedId } });

    // A execução devolve a decisão real (com a confirmação do operador, se
    // veio no pedido) — não o resultado seguro da pré-visualização.
    const result: MergePreview = {
      ...preview,
      whatsappConsent: consent.consent,
    };

    await tx.auditLog.create({
      data: {
        action: "CUSTOMER_MERGED",
        metadata: JSON.parse(
          JSON.stringify({
            consent: {
              conflict: consent.conflict,
              confirmedByUser: opts?.confirmConsent === true,
              keep: freshKeep.whatsappConsent,
              merged: freshMerged.whatsappConsent,
              result: consent.consent,
            },
            keepPhone: keep.phone,
            mergedEmail: merged.email,
            mergedName: merged.name,
            mergedPhone: merged.phone,
            mergedTaxId: merged.taxId,
            preview: result,
          })
        ),
        note: `cliente «${merged.name}» (${merged.phone}) juntado a «${keep.name}» (${keep.phone})`,
        userId,
      },
    });

    return result;
  });
}
