import type { Job, Prisma, PrismaClient } from "@generated/client";
import { AuditAction, type RepairCategory } from "@generated/client";
import type { JobStatusType } from "@shared/constants/job-statuses";
import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  INACTIVE_STATUSES,
  JOB_STATUS_FLOW,
  JobStatus,
} from "@shared/constants/job-statuses";
import type { RoleType } from "@shared/constants/roles";
import { Role } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import type {
  CreateJobInput,
  IntakeRepairItem,
  JobListQueryInput,
  UpdateJobInput,
} from "@shared/schemas/job.schema";
import { normalizeImei } from "@shared/utils/imei";
import {
  findMany as auditFindMany,
  findManyWithInclude as auditFindManyWithInclude,
} from "../repositories/audit.repository.js";
import {
  findUnique as customerFindUnique,
  upsert as customerUpsert,
} from "../repositories/customer.repository.js";
import {
  createBrand,
  findBrandFirst,
  upsertDevice,
} from "../repositories/device.repository.js";
import {
  createJobRepairs,
  findUniqueSimple,
  findUniqueWithCustomer,
  findUserUnique,
  groupByStatus,
  count as jobCount,
  createJob as jobCreateJob,
  findFirst as jobFindFirst,
  findMany as jobFindMany,
  findUnique as jobFindUnique,
  update as jobUpdate,
} from "../repositories/job.repository.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { generateJobCode } from "../utils/job-code.js";
import { assertJobMutable } from "../utils/job-mutations.js";
import { createAuditLog } from "./audit.service.js";
import { notify } from "./notification-dispatch.js";

export interface NotifyContext {
  prisma: PrismaClient;
  wsBroadcast?: (
    predicate: (c: { role: string; userId: string }) => boolean,
    payload: Record<string, unknown>
  ) => void;
}

export function computeMargin(job: {
  finalCost: number | { toNumber: () => number };
  partsUsed: Array<{ totalCost: number | { toNumber: () => number } }>;
}): number {
  const finalCost =
    typeof job.finalCost === "number"
      ? job.finalCost
      : job.finalCost.toNumber();
  const partsCost = job.partsUsed.reduce((s, p) => {
    const cost =
      typeof p.totalCost === "number" ? p.totalCost : p.totalCost.toNumber();
    return s + cost;
  }, 0);
  return finalCost - partsCost;
}

const VALID_TECH_ROLES: Set<RoleType> = new Set([Role.OWNER, Role.TECHNICIAN]);

const FD_CANCEL_WINDOW_MS = 30 * 60 * 1000;

async function validateTechnician(prisma: PrismaClient, technicianId: string) {
  const tech = await findUserUnique(prisma, technicianId);
  if (!tech) {
    return { error: "INVALID_TECHNICIAN" as const };
  }
  if (!VALID_TECH_ROLES.has(tech.role)) {
    return { error: "INVALID_TECHNICIAN" as const };
  }
  return null;
}

const JOB_INCLUDE = {
  customer: true,
  device: { include: { brand: true } },
  notes: {
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  partsUsed: true,
  partsWaiting: true,
  photos: true,
  repairs: true,
  technician: { select: { id: true, name: true, username: true } },
} as const satisfies Prisma.JobInclude;

export function computeFinalCost(job: {
  partsUsed: { totalCost: { toNumber: () => number } }[];
  repairs: { price: { toNumber: () => number } }[];
}): number {
  const repairsSum = job.repairs.reduce((s, r) => s + r.price.toNumber(), 0);
  const partsSum = job.partsUsed.reduce(
    (s, p) => s + p.totalCost.toNumber(),
    0
  );
  return repairsSum + partsSum;
}

async function seedJobRepairs(
  prisma: DbClient,
  jobId: string,
  repairs: IntakeRepairItem[],
  userId: string
): Promise<void> {
  const repairIds = repairs
    .map((r) => r.repairId)
    .filter((id): id is string => id != null);
  const uniqueRepairIds = new Set(repairIds);
  if (uniqueRepairIds.size !== repairIds.length) {
    throw new AppError("DUPLICATE_REPAIR");
  }
  await createJobRepairs(
    prisma,
    repairs.map((repair) => ({
      category: repair.category as RepairCategory,
      createdById: userId,
      jobId,
      price: repair.price,
      repairId: repair.repairId ?? null,
      repairName: repair.repairName,
    }))
  );
  for (const repair of repairs) {
    await createAuditLog(prisma, {
      action: AuditAction.REPAIR_ADDED,
      jobId,
      metadata: { repairId: repair.repairId },
      toValue: `${repair.repairName} — ${repair.price}`,
      userId,
    });
  }
}

function buildJobListWhere(query: JobListQueryInput): Prisma.JobWhereInput {
  const { imei, search, status, technicianId } = query;
  const where: Prisma.JobWhereInput = {};
  if (status) {
    where.status = status as Prisma.EnumJobStatusFilter<"Job">;
  }
  if (technicianId) {
    where.technicianId = technicianId;
  }
  if (search) {
    where.OR = [
      { jobCode: { contains: search, mode: "insensitive" } },
      { customer: { name: { contains: search, mode: "insensitive" } } },
      {
        device: { brand: { name: { contains: search, mode: "insensitive" } } },
      },
      { device: { model: { contains: search, mode: "insensitive" } } },
      // Allow pasting an IMEI straight into the general search box.
      { imei: { contains: normalizeImei(search), mode: "insensitive" } },
    ];
  }
  if (imei) {
    where.imei = { endsWith: normalizeImei(imei) };
  }
  return where;
}

export async function list(prisma: PrismaClient, query: JobListQueryInput) {
  const { cursor, limit } = query;

  const where = buildJobListWhere(query);
  if (cursor) {
    where.id = { lt: cursor };
  }

  const listInclude = {
    customer: true,
    device: { include: { brand: true } },
    technician: { select: { id: true, name: true, username: true } },
  } as const satisfies Prisma.JobInclude;

  const [jobs, totalCount] = await Promise.all([
    jobFindMany(prisma, where, listInclude, { id: "desc" }, limit + 1),
    cursor ? (Promise.resolve(null) as Promise<null>) : jobCount(prisma, where),
  ]);

  let nextCursor: string | null = null;
  if (jobs.length > limit) {
    const last = jobs.pop();
    if (last) {
      nextCursor = last.id;
    }
  }

  return { jobs, nextCursor, totalCount };
}

export async function getById(prisma: PrismaClient, id: string) {
  const job = await jobFindUnique(prisma, id, JOB_INCLUDE);
  if (!job) {
    return null;
  }

  const finalCost = computeFinalCost(job);
  return { ...job, finalCost };
}

export async function getMetrics(prisma: PrismaClient) {
  const groups = await groupByStatus(prisma);

  const allStatuses = [...ACTIVE_STATUSES, ...INACTIVE_STATUSES];
  const metrics: Record<string, number> = {};
  for (const s of allStatuses) {
    metrics[s] = 0;
  }
  for (const g of groups) {
    metrics[g.status] = g._count;
  }
  return metrics;
}

export async function create(
  prisma: PrismaClient,
  input: CreateJobInput,
  userId: string,
  notifyCtx: NotifyContext
) {
  if (input.warrantyForJobId) {
    const warrantyJob = await findUniqueWithCustomer(
      prisma,
      input.warrantyForJobId
    );
    const isCompleted =
      warrantyJob && COMPLETED_STATUSES.includes(warrantyJob.status);
    const sameCustomer = warrantyJob?.customer?.phone === input.customerPhone;
    if (!(isCompleted && sameCustomer)) {
      return { error: "INVALID_WARRANTY_REFERENCE" as const };
    }
  }

  let customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  };

  if (input.customerId) {
    const found = await customerFindUnique(prisma, input.customerId);
    if (!found) {
      return { error: "INVALID_CUSTOMER" as const };
    }
    customer = found;
  } else {
    const email = input.customerEmail?.trim() || null;
    customer = await customerUpsert(
      prisma,
      { phone: input.customerPhone },
      {
        name: input.customerName,
        ...(email ? { email } : {}),
      },
      {
        email,
        name: input.customerName,
        phone: input.customerPhone,
      }
    );
  }

  let brandId = input.deviceBrandId;
  if (!brandId) {
    const existing = await findBrandFirst(prisma, {
      name: { equals: input.deviceBrand, mode: "insensitive" },
    });
    if (existing) {
      brandId = existing.id;
    } else {
      const created = await createBrand(prisma, {
        name: input.deviceBrand,
      });
      brandId = created.id;
    }
  }

  const device = await upsertDevice(
    prisma,
    { brandId_model: { brandId, model: input.deviceModel } },
    {},
    { brand: { connect: { id: brandId } }, model: input.deviceModel }
  );

  const { accessCode, jobCode } = await generateJobCode(prisma);

  const job = await prisma.$transaction(async (tx) => {
    const created = await jobCreateJob(
      tx,
      {
        accessCode,
        color: input.color ?? null,
        conditionNotes: input.conditionNotes ?? null,
        createdBy: { connect: { id: userId } },
        customer: { connect: { id: customer.id } },
        imei: input.imei ? normalizeImei(input.imei) : null,
        depositAmount: input.depositAmount ?? null,
        device: { connect: { id: device.id } },
        estimatedCost: input.estimatedCost,
        estimatedDate: input.estimatedDate
          ? new Date(input.estimatedDate)
          : null,
        isWarrantyReturn: input.isWarrantyReturn ?? false,
        jobCode,
        reportedProblem: input.reportedProblem,
        technician: input.technicianId
          ? { connect: { id: input.technicianId } }
          : undefined,
        warrantyForJob: input.warrantyForJobId
          ? { connect: { id: input.warrantyForJobId } }
          : undefined,
      },
      JOB_INCLUDE
    );

    if (input.repairs && input.repairs.length > 0) {
      await seedJobRepairs(tx, created.id, input.repairs, userId);
    }

    await createAuditLog(tx, {
      action: AuditAction.JOB_CREATED,
      jobId: created.id,
      toValue: jobCode,
      userId,
    });

    return created;
  });

  notify(notifyCtx, {
    context: {
      customerName: customer.name,
      jobCode: job.jobCode,
      recipientPhone: customer.phone,
    },
    eventName: "job_created",
    jobId: job.id,
    recipients: { role: Role.OWNER },
  }).catch(() => {
    /* fire-and-forget */
  });

  const fullJob = await jobFindUnique(prisma, job.id, JOB_INCLUDE);

  return { ...(fullJob ?? job), finalCost: computeFinalCost(fullJob ?? job) };
}

const UPDATE_SPECIAL_FIELDS = new Set([
  "depositAmount",
  "estimatedDate",
  "imei",
  "technicianId",
]);

function hasNonSpecialFieldChanges(input: UpdateJobInput): boolean {
  return Object.keys(input).some((k) => !UPDATE_SPECIAL_FIELDS.has(k));
}

function buildJobUpdateData(input: UpdateJobInput): Prisma.JobUpdateInput {
  const { depositAmount, estimatedDate, imei, technicianId, ...rest } = input;
  const data: Prisma.JobUpdateInput = { ...rest };

  if (imei !== undefined) {
    data.imei = imei ? normalizeImei(imei) : null;
  }

  if (estimatedDate === null) {
    data.estimatedDate = null;
  } else if (estimatedDate) {
    data.estimatedDate = new Date(estimatedDate);
  }

  if (depositAmount === null) {
    data.depositAmount = null;
  }

  if (technicianId === null) {
    data.technician = { disconnect: true };
  } else if (technicianId) {
    data.technician = { connect: { id: technicianId } };
  }

  return data;
}

export async function update(
  prisma: PrismaClient,
  id: string,
  input: UpdateJobInput,
  userId: string
) {
  const job = await findUniqueSimple(prisma, id);
  if (!job) {
    return null;
  }
  const mutabilityError = assertJobMutable(job);
  if (mutabilityError) {
    return mutabilityError;
  }

  if (input.technicianId !== undefined && input.technicianId !== null) {
    const validation = await validateTechnician(prisma, input.technicianId);
    if (validation) {
      return validation;
    }
  }

  const data = buildJobUpdateData(input);

  const { technicianId } = input;

  const updated = await jobUpdate(prisma, id, data, JOB_INCLUDE);

  if (
    technicianId !== undefined &&
    technicianId !== (job.technicianId ?? undefined)
  ) {
    await createAuditLog(prisma, {
      action: AuditAction.TECHNICIAN_ASSIGNED,
      fromValue: job.technicianId ?? undefined,
      jobId: id,
      toValue: technicianId ?? "unassigned",
      userId,
    });
  }

  const costFieldsChanged =
    "estimatedCost" in input || "depositAmount" in input;
  if (costFieldsChanged) {
    await createAuditLog(prisma, {
      action: AuditAction.COST_UPDATED,
      jobId: id,
      note: "Cost fields updated",
      userId,
    });
  } else if (hasNonSpecialFieldChanges(input) || technicianId !== undefined) {
    await createAuditLog(prisma, {
      action: AuditAction.JOB_UPDATED,
      jobId: id,
      note: "Job fields updated",
      userId,
    });
  }

  return { ...updated, finalCost: computeFinalCost(updated) };
}

function canFrontDeskCancel(
  job: Pick<Job, "createdById" | "createdAt">,
  userId: string
):
  | { ok: true }
  | { ok: false; reason: "CANCEL_NOT_CREATOR" | "CANCEL_WINDOW_EXPIRED" } {
  if (job.createdById !== userId) {
    return { ok: false, reason: "CANCEL_NOT_CREATOR" };
  }
  const elapsed = Date.now() - job.createdAt.getTime();
  if (elapsed > FD_CANCEL_WINDOW_MS) {
    return { ok: false, reason: "CANCEL_WINDOW_EXPIRED" };
  }
  return { ok: true };
}

async function validateCancellation(
  prisma: PrismaClient,
  job: NonNullable<Awaited<ReturnType<typeof findUniqueSimple>>>,
  userId: string,
  requestingRole?: RoleType
): Promise<{ ok: boolean; error?: string }> {
  if (requestingRole === Role.FRONT_DESK) {
    const check = canFrontDeskCancel(job, userId);
    if (!check.ok) {
      return { ok: false, error: check.reason };
    }
  }

  if (job.isWarrantyReturn) {
    const claim = await prisma.returnClaim.findUnique({
      where: { reworkJobId: job.id },
      select: { id: true, status: true },
    });
    if (claim && claim.status === "OPEN") {
      return { ok: false, error: "REWORK_JOB_HAS_OPEN_CLAIM" };
    }
  }

  return { ok: true };
}

export async function transitionStatus(
  prisma: PrismaClient,
  id: string,
  newStatus: JobStatusType,
  userId: string,
  notifyCtx: NotifyContext,
  options?: {
    reason?: string;
    requestingRole: RoleType;
    actualLaborHours?: number;
  }
) {
  const job = await findUniqueSimple(prisma, id);
  if (!job) {
    return null;
  }

  if (newStatus === JobStatus.CANCELLED) {
    const cancelCheck = await validateCancellation(
      prisma,
      job,
      userId,
      options?.requestingRole
    );
    if (!cancelCheck.ok) {
      return {
        error: cancelCheck.error as
          | "CANCEL_NOT_CREATOR"
          | "CANCEL_WINDOW_EXPIRED"
          | "REWORK_JOB_HAS_OPEN_CLAIM",
      };
    }
  }

  const allowed = JOB_STATUS_FLOW[job.status as JobStatusType] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      allowedTransitions: allowed,
      currentStatus: job.status,
      error: "CONFLICT_STATUS_TRANSITION" as const,
    };
  }

  const updateData: Prisma.JobUpdateInput = {
    status: newStatus,
    updatedBy: { connect: { id: userId } },
  };

  if (newStatus === JobStatus.ON_HOLD && options?.reason) {
    updateData.holdReason = options.reason;
  }

  if (newStatus === JobStatus.DONE && options?.actualLaborHours !== undefined) {
    updateData.actualLaborHours = options.actualLaborHours;
  }

  let techAssigned = false;
  if (newStatus === JobStatus.IN_REPAIR && !job.technicianId) {
    updateData.technician = { connect: { id: userId } };
    techAssigned = true;
  }

  const updated = await jobUpdate(prisma, id, updateData, JOB_INCLUDE);

  await createAuditLog(prisma, {
    action: AuditAction.STATUS_CHANGED,
    fromValue: job.status,
    jobId: id,
    metadata: options?.reason ? { reason: options.reason } : undefined,
    note: options?.reason,
    toValue: newStatus,
    userId,
  });

  if (techAssigned) {
    await createAuditLog(prisma, {
      action: AuditAction.TECHNICIAN_ASSIGNED,
      fromValue: undefined,
      jobId: id,
      toValue: userId,
      userId,
    });
  }

  const templateName = STATUS_TEMPLATE_MAP[newStatus];
  if (templateName) {
    notify(notifyCtx, {
      context: {
        customerName: updated.customer?.name,
        jobCode: updated.jobCode,
        newStatus,
        recipientPhone: updated.customer?.phone,
      },
      eventName: templateName,
      jobId: id,
      recipients: { role: Role.OWNER },
    }).catch(() => {
      /* fire-and-forget */
    });
  }

  return { ...updated, finalCost: computeFinalCost(updated) };
}

const LOOKUP_INCLUDE_PUBLIC = {
  customer: { select: { name: true, phone: true } },
  device: { select: { model: true, brand: { select: { name: true } } } },
  repairs: { select: { repairName: true, price: true } },
  notes: {
    where: { isCustomerVisible: true },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

const LOOKUP_INCLUDE_AUTH = {
  customer: { select: { name: true } },
  device: { select: { model: true, brand: { select: { name: true } } } },
  repairs: { select: { repairName: true, price: true } },
  notes: {
    where: { isCustomerVisible: true },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

async function buildJobLookupPayload(
  prisma: PrismaClient,
  jobId: string,
  job: {
    jobCode: string;
    status: string;
    reportedProblem: string;
    estimatedDate: Date | null;
    createdAt: Date;
    customer: { name: string };
    device: { brand: { name: string }; model: string };
    notes: Array<{ content: string; createdAt: Date }>;
    repairs: Array<{ repairName: string; price: { toNumber: () => number } }>;
  }
) {
  const [statusTransitions, shopSettings] = await Promise.all([
    auditFindMany(
      prisma,
      { jobId, action: AuditAction.STATUS_CHANGED },
      { fromValue: true, toValue: true, createdAt: true },
      { createdAt: "asc" }
    ),
    findShopSettingsUnique(prisma),
  ]);

  return {
    createdAt: job.createdAt,
    customer: { name: job.customer.name },
    device: `${job.device.brand.name} ${job.device.model}`,
    estimatedDate: job.estimatedDate,
    jobCode: job.jobCode,
    notes: job.notes.map((n) => ({
      content: n.content,
      createdAt: n.createdAt,
    })),
    reportedProblem: job.reportedProblem,
    repairs: job.repairs.map((r) => ({
      name: r.repairName,
      price: r.price.toNumber(),
    })),
    shop: shopSettings
      ? {
          address: shopSettings.address,
          name: shopSettings.shopName,
          phone: shopSettings.phone,
        }
      : null,
    status: job.status,
    statusTransitions: statusTransitions.map((t) => ({
      date: t.createdAt,
      from: t.fromValue,
      to: t.toValue,
    })),
  };
}

export async function lookupByCode(
  prisma: PrismaClient,
  jobCode: string,
  phone4: string
): Promise<{ job: Record<string, unknown> | null; jobExists: boolean }> {
  const job = await jobFindFirst(prisma, { jobCode }, LOOKUP_INCLUDE_PUBLIC);
  if (!job) {
    return { job: null, jobExists: false };
  }

  const storedPhone = job.customer.phone;
  if (!storedPhone) {
    return { job: null, jobExists: true };
  }
  const normalizedPhone = storedPhone.replace(/\D/g, "");
  if (normalizedPhone.length < 4 || normalizedPhone.slice(-4) !== phone4) {
    return { job: null, jobExists: true };
  }

  const payload = await buildJobLookupPayload(
    prisma,
    job.id,
    job as unknown as Parameters<typeof buildJobLookupPayload>[2]
  );
  return { jobExists: true, job: payload };
}

export async function lookupByCodeAuth(
  prisma: PrismaClient,
  jobCode: string
): Promise<Record<string, unknown> | null> {
  const job = await jobFindFirst(prisma, { jobCode }, LOOKUP_INCLUDE_AUTH);
  if (!job) {
    return null;
  }

  return buildJobLookupPayload(
    prisma,
    job.id,
    job as unknown as Parameters<typeof buildJobLookupPayload>[2]
  );
}

const STATUS_TEMPLATE_MAP: Record<JobStatusType, string> = {
  [JobStatus.WAITING_FOR_PARTS]: "job_waiting_parts",
  [JobStatus.IN_REPAIR]: "job_in_repair",
  [JobStatus.ON_HOLD]: "job_on_hold",
  [JobStatus.DONE]: "job_done",
  [JobStatus.DELIVERED]: "job_delivered",
  [JobStatus.RETURNED]: "job_returned",
  [JobStatus.CANCELLED]: "job_cancelled",
  [JobStatus.INTAKE]: "",
};

export function getJobHistory(prisma: PrismaClient, jobId: string) {
  return auditFindManyWithInclude(
    prisma,
    { jobId },
    { user: { select: { id: true, name: true, role: true } } },
    { createdAt: "desc" }
  );
}
