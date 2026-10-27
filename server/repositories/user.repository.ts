import type { Prisma } from "@generated/client";
import type { DbClient } from "./types.js";

type UserWhereInput = Prisma.UserWhereInput;
type UserOrderByWithRelationInput =
  | Prisma.UserOrderByWithRelationInput
  | Prisma.UserOrderByWithRelationInput[];
type UserSelect = Prisma.UserSelect;

export const USER_SELECT: UserSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  image: true,
  createdAt: true,
};

// Safe projection for technicians/front desk: enough to render an assignee
// picker, without emails, account flags or audit dates.
export const USER_SELECT_MINIMAL: UserSelect = {
  id: true,
  username: true,
  name: true,
  role: true,
  isActive: true,
};

export const USER_SELECT_NO_IMAGE: UserSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
};

export async function findMany(
  prisma: DbClient,
  where: UserWhereInput,
  select: UserSelect,
  orderBy: UserOrderByWithRelationInput,
  take: number
) {
  return await prisma.user.findMany({ where, select, orderBy, take });
}

export async function count(prisma: DbClient, where: UserWhereInput) {
  return await prisma.user.count({ where });
}

export async function findUniqueById(
  prisma: DbClient,
  id: string,
  select: UserSelect
) {
  return await prisma.user.findUnique({ where: { id }, select });
}

export async function findFirst(prisma: DbClient, where: UserWhereInput) {
  return await prisma.user.findFirst({ where });
}

export async function updateStatus(
  prisma: DbClient,
  id: string,
  isActive: boolean,
  select: UserSelect
) {
  return await prisma.user.update({
    where: { id },
    data: { isActive },
    select,
  });
}

export async function updateUserProfile(
  prisma: DbClient,
  id: string,
  data: Record<string, unknown>,
  select: UserSelect
) {
  return await prisma.user.update({ where: { id }, data, select });
}

export async function findFailedAttempts(prisma: DbClient, userId: string) {
  return await prisma.user.findUnique({
    where: { id: userId },
    select: { failedLoginAttempts: true },
  });
}

export async function incrementFailedAttempt(
  prisma: DbClient,
  userId: string,
  data: { failedLoginAttempts: { increment: number }; lockedUntil?: Date }
) {
  return await prisma.user.update({
    data,
    where: { id: userId },
  });
}

export async function resetFailedAttempts(prisma: DbClient, userId: string) {
  return await prisma.user.updateMany({
    data: { failedLoginAttempts: 0, lockedUntil: null },
    where: { id: userId },
  });
}

export async function updateCredentialPassword(
  prisma: DbClient,
  userId: string,
  hashedPassword: string
) {
  return await prisma.account.updateMany({
    where: { userId, providerId: "credential" },
    data: { password: hashedPassword },
  });
}

export async function updateMustChangePassword(
  prisma: DbClient,
  userId: string,
  value: boolean
) {
  return await prisma.user.update({
    where: { id: userId },
    data: { mustChangePassword: value },
  });
}

export async function findSessions(prisma: DbClient, userId: string) {
  return await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findSessionById(prisma: DbClient, id: string) {
  return await prisma.session.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
}

export async function deleteSession(prisma: DbClient, id: string) {
  return await prisma.session.delete({ where: { id } });
}

export async function jobCount(prisma: DbClient, where: Prisma.JobWhereInput) {
  return await prisma.job.count({ where });
}

export async function deleteUserSessions(prisma: DbClient, userId: string) {
  return await prisma.session.deleteMany({
    where: { userId },
  });
}
