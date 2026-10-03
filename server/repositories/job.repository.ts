import type { Prisma, RepairCategory } from "@generated/client";
import type { DbClient } from "./types.js";

type JobWhereInput = Prisma.JobWhereInput;
type JobInclude = Prisma.JobInclude;
type JobUpdateInput = Prisma.JobUpdateInput;

export async function findMany(
  prisma: DbClient,
  where: JobWhereInput,
  include: JobInclude,
  orderBy: Prisma.JobOrderByWithRelationInput,
  take: number,
  omit?: Prisma.JobOmit
) {
  return await prisma.job.findMany({ where, include, omit, orderBy, take });
}

export async function count(prisma: DbClient, where: JobWhereInput) {
  return await prisma.job.count({ where });
}

export async function findUnique(
  prisma: DbClient,
  id: string,
  include: JobInclude
) {
  return await prisma.job.findUnique({ where: { id }, include });
}

export async function findFirst(
  prisma: DbClient,
  where: JobWhereInput,
  include: JobInclude
) {
  return await prisma.job.findFirst({ where, include });
}

export async function groupByStatus(prisma: DbClient) {
  return await prisma.job.groupBy({
    by: ["status"],
    _count: true,
  });
}

export async function findUniqueSimple(prisma: DbClient, id: string) {
  return await prisma.job.findUnique({ where: { id } });
}

export async function findUniqueWithCustomer(prisma: DbClient, id: string) {
  return await prisma.job.findUnique({
    where: { id },
    include: { customer: true },
  });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: JobUpdateInput,
  include: JobInclude
) {
  return await prisma.job.update({ data, where: { id }, include });
}

export async function createJob(
  prisma: DbClient,
  data: Prisma.JobCreateInput,
  include: JobInclude
) {
  return await prisma.job.create({ data, include });
}

export async function createJobRepairs(
  prisma: DbClient,
  data: Array<{
    category: RepairCategory;
    createdById: string;
    jobId: string;
    price: number;
    repairId: string | null;
    repairName: string;
  }>
) {
  return await prisma.jobRepair.createMany({ data });
}

export async function findUserUnique(prisma: DbClient, id: string) {
  return await prisma.user.findUnique({ where: { id } });
}
