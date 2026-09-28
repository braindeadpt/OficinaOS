import type { DbClient } from "./types.js";

export function findCredentialAccount(prisma: DbClient, userId: string) {
  return prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { password: true },
  });
}

export function updateCredentialPassword(
  prisma: DbClient,
  userId: string,
  hashedPassword: string
) {
  return prisma.account.updateMany({
    where: { userId, providerId: "credential" },
    data: { password: hashedPassword },
  });
}

export function updateMustChangePassword(
  prisma: DbClient,
  userId: string,
  value: boolean
) {
  return prisma.user.update({
    where: { id: userId },
    data: { mustChangePassword: value },
  });
}

export function findUserByUsername(prisma: DbClient, username: string) {
  return prisma.user.findFirst({
    where: { username },
    select: { id: true },
  });
}

export function updateUsername(
  prisma: DbClient,
  userId: string,
  username: string
) {
  return prisma.user.update({
    where: { id: userId },
    data: { username },
  });
}
