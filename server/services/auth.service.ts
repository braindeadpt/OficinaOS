import { AppError } from "@shared/errors/app-error.js";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import {
  deleteOtherSessions,
  findCredentialAccount,
  findUserByUsername,
  updateCredentialPassword,
  updateMustChangePassword,
  updateUsername,
} from "../repositories/auth.repository.js";
import type { DbClient } from "../repositories/types.js";

export async function changePassword(
  prisma: DbClient & {
    $transaction: (fn: (tx: DbClient) => Promise<unknown>) => Promise<unknown>;
  },
  userId: string,
  oldPassword: string,
  newPassword: string,
  username?: string,
  currentSessionId?: string
) {
  if (oldPassword === newPassword) {
    throw new AppError("PASSWORD_SAME_AS_OLD");
  }

  const account = await findCredentialAccount(prisma, userId);
  if (!account?.password) {
    throw new AppError("NO_PASSWORD_SET");
  }

  const isValid = await verifyPassword({
    hash: account.password,
    password: oldPassword,
  });
  if (!isValid) {
    throw new AppError("CURRENT_PASSWORD_INCORRECT");
  }

  if (username) {
    const taken = await findUserByUsername(prisma, username);
    if (taken && taken.id !== userId) {
      throw new AppError("USERNAME_EXISTS");
    }
  }

  const hashedNewPassword = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await updateCredentialPassword(tx, userId, hashedNewPassword);
    if (username) {
      await updateUsername(tx, userId, username);
    }
    await updateMustChangePassword(tx, userId, false);
    // A stolen session cookie outlives the rotation otherwise — every
    // other session for this user is revoked; the caller's stays.
    if (currentSessionId) {
      await deleteOtherSessions(tx, userId, currentSessionId);
    }
  });

  return { success: true };
}
