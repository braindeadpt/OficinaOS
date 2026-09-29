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
  if (input.whatsappConsent !== undefined) {
    // Timestamp records when consent was (re)granted; revocation keeps the
    // flag change but the timestamp only moves on opt-in.
    updateData.whatsappConsent = input.whatsappConsent;
    updateData.whatsappConsentAt = input.whatsappConsent ? new Date() : null;
  }

  return await customerUpsert(prisma, { phone: input.phone }, updateData, {
    email,
    name: input.name,
    phone: input.phone,
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
  const { cursor, limit, search } = query;

  const where: Prisma.CustomerWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }
  if (cursor) {
    where.id = { lt: cursor };
  }

  const [customers, totalCount] = await Promise.all([
    customerFindMany(
      prisma,
      where,
      { _count: { select: { jobs: true } } },
      { id: "desc" },
      limit + 1
    ),
    cursor ? Promise.resolve(null) : customerCount(prisma, where),
  ]);

  let nextCursor: string | null = null;
  if (customers.length > limit) {
    const last = customers.pop();
    if (last) {
      nextCursor = last.id;
    }
  }

  return { customers, nextCursor, totalCount };
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
