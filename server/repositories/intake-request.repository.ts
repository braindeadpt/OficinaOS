import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type IntakeRequestWhereInput = Prisma.IntakeRequestWhereInput;
type IntakeRequestUpdateInput = Prisma.IntakeRequestUpdateInput;
type IntakeRequestUncheckedCreateInput =
  Prisma.IntakeRequestUncheckedCreateInput;

export async function create(
  prisma: DbClient,
  data: IntakeRequestUncheckedCreateInput
) {
  return await prisma.intakeRequest.create({ data });
}

export async function findMany(
  prisma: DbClient,
  where: IntakeRequestWhereInput,
  orderBy: Prisma.IntakeRequestOrderByWithRelationInput,
  take: number
) {
  return await prisma.intakeRequest.findMany({
    include: { job: { select: { jobCode: true } } },
    orderBy,
    take,
    where,
  });
}

export async function findUnique(prisma: DbClient, id: string) {
  return await prisma.intakeRequest.findUnique({ where: { id } });
}

export async function update(
  prisma: DbClient,
  id: string,
  data: IntakeRequestUpdateInput
) {
  return await prisma.intakeRequest.update({ data, where: { id } });
}
