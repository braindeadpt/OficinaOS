import { Prisma, type PrismaClient } from "@generated/client";
import { Role, type RoleType } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import type {
  ActivityListQueryInput,
  UserListQueryInput,
} from "@shared/schemas/auth.schema";
import { hashPassword } from "better-auth/crypto";
import {
  create as auditCreate,
  findMany as auditFindMany,
  findUnique as auditFindUnique,
} from "../repositories/audit.repository.js";
import type { DbClient } from "../repositories/types.js";
import {
  deleteSession,
  deleteUserSessions,
  findSessionById,
  findSessions,
  jobCount,
  USER_SELECT,
  USER_SELECT_NO_IMAGE,
  updateCredentialPassword as updateCredentialPasswordRepo,
  updateMustChangePassword as updateMustChangePasswordRepo,
  count as userCount,
  findFirst as userFindFirst,
  findMany as userFindMany,
  findUniqueById as userFindUniqueById,
  updateUserProfile as userUpdateProfile,
  updateStatus as userUpdateStatus,
} from "../repositories/user.repository.js";
import { resolveTechnicianNames } from "./technician-names.js";

async function checkUniqueFields(
  prisma: DbClient,
  checks: Array<{ field: "email" | "username"; value: string }>,
  excludeId: string
): Promise<string | null> {
  for (const { field, value } of checks) {
    const where: Record<string, unknown> = {
      [field]: value,
      NOT: { id: excludeId },
    };
    const existing = await userFindFirst(prisma, where);
    if (existing) {
      const label = field.charAt(0).toUpperCase() + field.slice(1);
      return `${label} already in use`;
    }
  }
  return null;
}

function isUniqueViolation(err: unknown): string | null {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== "P2002"
  ) {
    return null;
  }
  const target = (err.meta as { target: string[] })?.target?.[0];
  const label = target
    ? target.charAt(0).toUpperCase() + target.slice(1)
    : "Field";
  return `${label} already in use`;
}

function buildUpdateData(
  fields: Record<string, string | undefined>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}

export async function list(prisma: DbClient, query: UserListQueryInput) {
  const { cursor, limit, search } = query;

  const where: Prisma.UserWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  if (cursor) {
    where.id = { lt: cursor };
  }

  const [users, totalCount] = await Promise.all([
    userFindMany(prisma, where, USER_SELECT, { id: "desc" }, limit + 1),
    cursor ? Promise.resolve(null) : userCount(prisma, where),
  ]);

  let nextCursor: string | null = null;
  if (users.length > limit) {
    users.pop();
    nextCursor = users.at(-1)?.id ?? null;
  }

  return { users, nextCursor, totalCount };
}

export async function getById(prisma: DbClient, id: string) {
  const user = await userFindUniqueById(prisma, id, USER_SELECT);
  if (!user) {
    throw new AppError("USER_NOT_FOUND");
  }
  return user;
}

export async function createUser(
  prisma: DbClient,
  authApi: {
    createUser: (args: unknown) => Promise<{ user?: { id: string } }>;
  },
  headers: unknown,
  data: { username: string; email: string; password: string; role: string },
  userId: string,
  callerRole: RoleType
) {
  const { username, email, password, role } = data;

  // Only an OWNER may create another OWNER — non-owner callers can at most
  // provision TECHNICIAN / FRONT_DESK accounts.
  if (role === Role.OWNER && callerRole !== Role.OWNER) {
    throw new AppError("FORBIDDEN");
  }

  const existing = await userFindFirst(prisma, {
    OR: [{ username }, { email }],
  });
  if (existing) {
    const errorCode =
      existing.username === username ? "USERNAME_EXISTS" : "EMAIL_EXISTS";
    throw new AppError(errorCode);
  }

  const created = await authApi.createUser({
    headers,
    body: {
      email,
      password,
      name: username,
      role: role as RoleType,
      data: {
        username,
        mustChangePassword: true,
      },
    },
  });

  if (!created?.user?.id) {
    throw new AppError("INTERNAL_ERROR");
  }

  const user = await userFindUniqueById(
    prisma,
    created.user.id,
    USER_SELECT_NO_IMAGE
  );

  await auditCreate(prisma, {
    action: "USER_CREATED" as Parameters<typeof auditCreate>[1]["action"],
    jobId: null,
    toValue: `${username} (${role})`,
    userId,
  });

  return user;
}

export async function toggleStatus(
  prisma: DbClient,
  id: string,
  isActive: boolean,
  callerRole: RoleType
) {
  const target = await userFindUniqueById(prisma, id, { id: true, role: true });
  if (!target) {
    throw new AppError("USER_NOT_FOUND");
  }
  if (target.role === Role.OWNER && callerRole !== Role.OWNER) {
    throw new AppError("FORBIDDEN");
  }
  return await userUpdateStatus(prisma, id, isActive, USER_SELECT_NO_IMAGE);
}

export async function resetPassword(
  prisma: PrismaClient,
  id: string,
  newPassword: string,
  userId: string,
  callerRole: RoleType
) {
  const targetUser = await userFindUniqueById(prisma, id, {
    id: true,
    role: true,
    username: true,
  });
  if (!targetUser) {
    throw new AppError("USER_NOT_FOUND");
  }
  if (targetUser.role === Role.OWNER && callerRole !== Role.OWNER) {
    throw new AppError("FORBIDDEN");
  }

  const hashed = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await updateCredentialPasswordRepo(tx, id, hashed);
    await updateMustChangePasswordRepo(tx, id, true);
    await deleteUserSessions(tx, id);
  });

  await auditCreate(prisma, {
    action: "PASSWORD_RESET" as Parameters<typeof auditCreate>[1]["action"],
    jobId: null,
    toValue: `Password reset for ${targetUser.username}`,
    userId,
  });
}

export async function updateUserProfileService(
  prisma: DbClient,
  id: string,
  data: { name?: string; email?: string; username?: string }
) {
  const { email, username } = data;
  let { name } = data;

  // A name that was only ever a copy of the login (the seeded owner is
  // name "Admin", username "admin") follows a username change, so the
  // greeting and job history never keep showing the old placeholder.
  if (username) {
    const current = await userFindUniqueById(prisma, id, {
      name: true,
      username: true,
    });
    const placeholder =
      current?.name &&
      current.username &&
      current.name.trim().toLowerCase() === current.username.toLowerCase();
    const nameUntouched = name === undefined || name === current?.name;
    if (
      placeholder &&
      nameUntouched &&
      username.toLowerCase() !== current.username?.toLowerCase()
    ) {
      name = username;
    }
  }

  const updateData = buildUpdateData({ name, email, username });

  if (Object.keys(updateData).length === 0) {
    throw new AppError("AT_LEAST_ONE_FIELD");
  }

  const checks: Array<{ field: "email" | "username"; value: string }> = [];
  if (email) {
    checks.push({ field: "email", value: email });
  }
  if (username) {
    checks.push({ field: "username", value: username });
  }
  if (checks.length > 0) {
    const conflict = await checkUniqueFields(prisma, checks, id);
    if (conflict) {
      throw new AppError("CONFLICT", { message: conflict });
    }
  }

  try {
    const updated = await userUpdateProfile(
      prisma,
      id,
      updateData,
      USER_SELECT_NO_IMAGE
    );
    return updated;
  } catch (err) {
    const conflictMsg = isUniqueViolation(err);
    if (conflictMsg) {
      throw new AppError("CONFLICT", { message: conflictMsg });
    }
    throw err;
  }
}

export async function getActivity(
  prisma: DbClient,
  id: string,
  query: ActivityListQueryInput
) {
  const take = query.limit;
  const cursor = query.cursor;

  let cursorFilter: Record<string, unknown> = {};
  if (cursor) {
    const cursorLog = await auditFindUnique(
      prisma,
      { id: cursor },
      { createdAt: true }
    );
    if (!cursorLog) {
      throw new AppError("INVALID_CURSOR");
    }
    cursorFilter = {
      OR: [
        { createdAt: { lt: cursorLog.createdAt } },
        {
          createdAt: cursorLog.createdAt,
          id: { lt: cursor },
        },
      ],
    };
  }

  const logs = await auditFindMany(
    prisma,
    { userId: id, ...cursorFilter },
    {
      id: true,
      action: true,
      fromValue: true,
      toValue: true,
      metadata: true,
      createdAt: true,
    },
    [{ createdAt: "desc" }, { id: "desc" }],
    take
  );

  const nextCursor = logs.length === take ? logs.at(-1)?.id : null;

  return { items: await resolveTechnicianNames(prisma, logs), nextCursor };
}

export async function getStats(prisma: DbClient, id: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [completedJobs, monthlyJobs] = await Promise.all([
    jobCount(prisma, {
      technicianId: id,
      status: { in: ["DONE", "DELIVERED"] },
    }),
    jobCount(prisma, {
      technicianId: id,
      status: { in: ["DONE", "DELIVERED"] },
      createdAt: { gte: monthStart },
    }),
  ]);

  return { completedJobs, monthlyJobs };
}

export async function getSessions(
  prisma: DbClient,
  id: string,
  currentSessionId: string
) {
  const sessions = await findSessions(prisma, id);

  return sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: s.id === currentSessionId,
  }));
}

export async function revokeSession(
  prisma: DbClient,
  userId: string,
  sessionId: string,
  currentSessionId: string
) {
  const session = await findSessionById(prisma, sessionId);

  if (!session || session.userId !== userId) {
    throw new AppError("SESSION_NOT_FOUND");
  }

  if (sessionId === currentSessionId) {
    throw new AppError("CANNOT_END_CURRENT_SESSION");
  }

  await deleteSession(prisma, sessionId);
}
