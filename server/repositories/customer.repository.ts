import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type CustomerWhereInput = Prisma.CustomerWhereInput;
type CustomerOrderByWithRelationInput =
  | Prisma.CustomerOrderByWithRelationInput
  | Prisma.CustomerOrderByWithRelationInput[];
type CustomerInclude = Prisma.CustomerInclude;

export async function upsert(
  prisma: DbClient,
  where: Prisma.CustomerWhereUniqueInput,
  update: Record<string, unknown>,
  create: Prisma.CustomerCreateInput
) {
  return await prisma.customer.upsert({ where, update, create });
}

export async function findUnique(prisma: DbClient, id: string) {
  return await prisma.customer.findUnique({ where: { id } });
}

export async function findCustomerByPhone(prisma: DbClient, phone: string) {
  return await prisma.customer.findUnique({ where: { phone } });
}

/**
 * Finds a customer whose stored phone normalizes to the same value as
 * `normalizedPhone` (see shared/utils/phone.ts — the SQL mirrors it), so
 * "912 345 678" matches an existing "912345678".
 */
export async function findByNormalizedPhone(
  prisma: DbClient,
  normalizedPhone: string,
  dialCode = "351",
  rawDigits = ""
): Promise<{ id: string; name: string; phone: string } | null> {
  const rows = await prisma.$queryRaw<
    { id: string; name: string; phone: string }[]
  >`
    SELECT id, name, phone
    FROM (
      SELECT id, name, phone,
             btrim(phone) AS trimmed,
             regexp_replace(phone, '[^0-9]', '', 'g') AS digits
      FROM customers
    ) c
    WHERE (
      CASE
        WHEN c.trimmed LIKE '+%' THEN '+' || c.digits
        WHEN c.digits LIKE '00%' THEN '+' || substr(c.digits, 3)
        -- Indicativo escrito sem o "+" ("351912345678"): os dígitos já o
        -- trazem, não se acrescenta outra vez — mesma regra do normalizePhoneE164.
        WHEN c.digits LIKE ${dialCode} || '%'
             AND length(regexp_replace(c.digits, '^0+', '')) - ${dialCode.length} >= 8
          THEN '+' || regexp_replace(c.digits, '^0+', '')
        ELSE '+' || ${dialCode} || regexp_replace(c.digits, '^0+', '')
      END
    ) = ${normalizedPhone}
    -- Exact stored form first: in a duplicate pair ("+351912345678" vs
    -- legacy "912345678") an import that carries the international form
    -- belongs to the row already written that way, not to whichever id
    -- sorts first. O mesmo para os dígitos exatamente como foram escritos:
    -- "912345678" pertence à ficha nacional, não à internacionalizada.
    ORDER BY CASE
      WHEN c.trimmed = ${normalizedPhone} THEN 0
      WHEN c.digits = ${rawDigits} THEN 0
      ELSE 1
    END, id
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findUniqueWithJobs(prisma: DbClient, id: string) {
  return await prisma.customer.findUnique({
    where: { id },
    include: {
      jobs: {
        include: {
          device: {
            select: { model: true, brand: { select: { name: true } } },
          },
          repairs: { select: { repairName: true, price: true } },
          partsUsed: { select: { partName: true, totalCost: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function findMany(
  prisma: DbClient,
  where: CustomerWhereInput,
  include: CustomerInclude,
  orderBy: CustomerOrderByWithRelationInput,
  take: number
) {
  return await prisma.customer.findMany({ where, include, orderBy, take });
}

export async function count(prisma: DbClient, where: CustomerWhereInput) {
  return await prisma.customer.count({ where });
}

export async function groupByConsent(prisma: DbClient) {
  return await prisma.customer.groupBy({
    _count: { _all: true },
    by: ["whatsappConsent"],
  });
}

export async function search(
  prisma: DbClient,
  where: CustomerWhereInput,
  select: Prisma.CustomerSelect,
  take: number,
  orderBy: CustomerOrderByWithRelationInput
) {
  return await prisma.customer.findMany({ where, select, take, orderBy });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: Record<string, unknown>
) {
  return await prisma.customer.update({ where: { id }, data });
}

/**
 * IDs of customers whose phone contains `digits` once separators and a
 * Portuguese +351/00351 prefix are ignored (the SQL mirrors
 * phoneSearchDigits in shared/utils/phone.ts).
 */
export async function findIdsByPhoneDigits(
  prisma: DbClient,
  digits: string,
  limit: number,
  dialCode = "351"
): Promise<string[]> {
  // Nacional significativo: 9 dígitos em PT/FR, 10 em GB/US — o corte
  // serve só para distinguir "351912345678" (com indicativo) de um
  // número nacional longo; errar para cima não exclui resultados.
  const intlLength = dialCode.length + 9;
  const stripLen = dialCode.length + 1;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM (
      SELECT id,
             btrim(phone) AS trimmed,
             regexp_replace(phone, '[^0-9]', '', 'g') AS digits
      FROM customers
    ) c
    CROSS JOIN LATERAL (
      SELECT CASE WHEN c.digits LIKE '00%' THEN substr(c.digits, 3)
                  ELSE c.digits END AS d,
             (c.trimmed LIKE '+%' OR c.digits LIKE '00%') AS intl
    ) p
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN p.d LIKE ${dialCode} || '%'
                    AND (p.intl OR length(p.d) >= ${intlLength})
                 THEN substr(p.d, ${stripLen})
               ELSE p.d
             END AS national
    ) n
    WHERE n.national LIKE '%' || ${digits} || '%'
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}
