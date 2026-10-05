import type { Prisma, PrismaClient } from "@generated/client";
import type {
  CreateCustomerInput,
  CustomerListQueryInput,
  CustomerSearchQueryInput,
  UpdateCustomerInput,
} from "@shared/schemas/customer.schema";
import {
  count as customerCount,
  findMany as customerFindMany,
  findUnique as customerFindUnique,
  groupByConsent as customerGroupByConsent,
  search as customerSearch,
  update as customerUpdate,
  upsert as customerUpsert,
  findUniqueWithJobs,
} from "../repositories/customer.repository.js";

export async function create(prisma: PrismaClient, input: CreateCustomerInput) {
  const email = input.email?.trim() || null;

  const updateData: Record<string, unknown> = {};
  if (input.name) {
    updateData.name = input.name;
  }
  if (email) {
    updateData.email = email;
  }
  // Granting consent via the intake upsert is fine; revoking is not — a
  // quick-add form with the box unchecked must not silently opt out an
  // existing opted-in customer. Revocation goes through update().
  if (input.whatsappConsent) {
    updateData.whatsappConsent = true;
    updateData.whatsappConsentAt = new Date();
  }
  const taxId = input.taxId?.trim() || null;
  if (taxId) {
    updateData.taxId = taxId;
  }

  return await customerUpsert(prisma, { phone: input.phone }, updateData, {
    email,
    name: input.name,
    phone: input.phone,
    taxId,
    whatsappConsent: input.whatsappConsent ?? false,
    whatsappConsentAt: input.whatsappConsent ? new Date() : null,
  });
}

export async function update(
  prisma: PrismaClient,
  id: string,
  data: UpdateCustomerInput
) {
  const existing = await customerFindUnique(prisma, id);
  if (!existing) {
    return null;
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) {
    updateData.name = data.name;
  }
  if (data.phone !== undefined) {
    updateData.phone = data.phone;
  }
  if (data.email !== undefined) {
    updateData.email = data.email?.trim() || null;
  }
  if (data.taxId !== undefined) {
    updateData.taxId = data.taxId?.trim() || null;
  }
  if (data.whatsappConsent !== undefined) {
    updateData.whatsappConsent = data.whatsappConsent;
    updateData.whatsappConsentAt = data.whatsappConsent ? new Date() : null;
  }

  if (Object.keys(updateData).length === 0) {
    return existing;
  }

  return await customerUpdate(prisma, id, updateData);
}

export async function list(
  prisma: PrismaClient,
  query: CustomerListQueryInput
) {
  const { consent, cursor, limit, search } = query;

  const where: Prisma.CustomerWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }
  // GDPR campaign/audit support: list only opted-in (or only opted-out)
  // customers. whatsappConsent defaults to false in the schema, so the
  // "false" filter naturally includes everyone who was never asked.
  if (consent !== undefined) {
    where.whatsappConsent = consent === "true";
  }
  if (cursor) {
    where.id = { lt: cursor };
  }

  const [customers, totalCount, consentGroups] = await Promise.all([
    customerFindMany(
      prisma,
      where,
      { _count: { select: { jobs: true } } },
      { id: "desc" },
      limit + 1
    ),
    cursor ? Promise.resolve(null) : customerCount(prisma, where),
    cursor ? Promise.resolve([]) : customerGroupByConsent(prisma),
  ]);

  let nextCursor: string | null = null;
  if (customers.length > limit) {
    const last = customers.pop();
    if (last) {
      nextCursor = last.id;
    }
  }

  // Global opt-in overview (unfiltered): powers the consent-rate card.
  const consentSummary = { optedIn: 0, optedOut: 0 };
  for (const group of Array.isArray(consentGroups) ? consentGroups : []) {
    if (group.whatsappConsent) {
      consentSummary.optedIn += group._count._all;
    } else {
      consentSummary.optedOut += group._count._all;
    }
  }

  return { consentSummary, customers, nextCursor, totalCount };
}

export async function search(
  prisma: PrismaClient,
  query: CustomerSearchQueryInput
) {
  const { q, limit } = query;

  return await customerSearch(
    prisma,
    {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { startsWith: q } },
      ],
    },
    {
      _count: { select: { jobs: true } },
      email: true,
      id: true,
      name: true,
      phone: true,
      whatsappConsent: true,
    },
    limit,
    { name: "asc" }
  );
}

export async function getById(prisma: PrismaClient, id: string) {
  const customer = await findUniqueWithJobs(prisma, id);
  if (!customer) {
    return null;
  }
  const { jobs, ...customerInfo } = customer;
  return {
    ...customerInfo,
    jobs: jobs.map((j) => ({
      createdAt: j.createdAt.toISOString(),
      deviceModel: `${j.device.brand.name} ${j.device.model}`,
      estimatedCost: Number(j.estimatedCost),
      finalCost:
        j.repairs.reduce((sum, r) => sum + Number(r.price), 0) +
        j.partsUsed.reduce((sum, p) => sum + Number(p.totalCost), 0),
      id: j.id,
      jobCode: j.jobCode,
      reportedProblem: j.reportedProblem,
      status: j.status,
    })),
  };
}
