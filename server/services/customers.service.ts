import type { Prisma, PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  CreateCustomerInput,
  CustomerListQueryInput,
  CustomerSearchQueryInput,
  UpdateCustomerInput,
} from "@shared/schemas/customer.schema";
import { normalizePhone } from "@shared/utils/phone";
import {
  count as customerCount,
  findMany as customerFindMany,
  findUnique as customerFindUnique,
  groupByConsent as customerGroupByConsent,
  search as customerSearch,
  update as customerUpdate,
  upsert as customerUpsert,
  findByNormalizedPhone,
  findUniqueWithJobs,
} from "../repositories/customer.repository.js";

export async function create(prisma: PrismaClient, input: CreateCustomerInput) {
  const email = input.email?.trim() || null;

  // Same phone in another format ("912 345 678" vs "912345678") would slip
  // past the unique index and create a duplicate customer. Surface the
  // existing one instead; the caller can explicitly opt to reuse it.
  const existing = await findByNormalizedPhone(
    prisma,
    normalizePhone(input.phone)
  );
  if (existing && !input.useExisting) {
    throw new AppError("DUPLICATE_CUSTOMER_PHONE", {
      existingCustomerId: existing.id,
      existingCustomerName: existing.name,
    });
  }

  // Only reached for an existing customer the caller chose to reuse — keep
  // their name, fill in what the form added.
  const updateData: Record<string, unknown> = {};
  if (email) {
    updateData.email = email;
  }
  // Granting consent via the quick-add upsert is fine; revoking is not — a
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

  const phone = existing?.phone ?? input.phone.trim();
  return await customerUpsert(prisma, { phone }, updateData, {
    email,
    name: input.name,
    phone,
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
