import crypto from "node:crypto";
import type { Job, PrismaClient } from "@generated/client";
import { AuditAction, Prisma, type RepairCategory } from "@generated/client";
import { isImeiCategory } from "@shared/constants/device-categories";
import type { JobStatusType } from "@shared/constants/job-statuses";
import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  INACTIVE_STATUSES,
  JOB_STATUS_FLOW,
  JobStatus,
} from "@shared/constants/job-statuses";
import type { PaymentMethodType } from "@shared/constants/payment-methods";
import type { RoleType } from "@shared/constants/roles";
import { Role } from "@shared/constants/roles";
import { AppError } from "@shared/errors/app-error.js";
import { buildIntakeDocument } from "@shared/intake-document.js";
import { describeLoanerDevice } from "@shared/loaner-description.js";
import type {
  CreateJobInput,
  IntakeRepairItem,
  JobListQueryInput,
  UpdateJobInput,
} from "@shared/schemas/job.schema";
import { isValidImei, normalizeImei } from "@shared/utils/imei";
import { normalizePhone } from "@shared/utils/phone";
import {
  findMany as auditFindMany,
  findManyWithInclude as auditFindManyWithInclude,
} from "../repositories/audit.repository.js";
import {
  findUnique as customerFindUnique,
  upsert as customerUpsert,
  findByNormalizedPhone,
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
import { createPayment as createPaymentRepo } from "../repositories/payment.repository.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { generateJobCode } from "../utils/job-code.js";
import { assertJobMutable } from "../utils/job-mutations.js";
import { logger } from "../utils/logger.js";
import { toPublicShop } from "../utils/public-shop.js";
import { createAuditLog } from "./audit.service.js";
import {
  assertLoanerAssignable,
  checkoutLoanerDevice,
} from "./loaner.service.js";
import { notify } from "./notification-dispatch.js";
import {
  computeJobBalance,
  settlePaymentOnDelivery,
} from "./payment.service.js";
import {
  consumeSignatureSession,
  intakeDocumentHash,
} from "./signature-session.service.js";
import { resolveTechnicianNames } from "./technician-names.js";

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
  externalRepairs?: Array<{
    costFinal: number | { toNumber: () => number } | null;
  }>;
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
  const externalCost = (job.externalRepairs ?? []).reduce((s, r) => {
    if (r.costFinal === null) {
      return s;
    }
    return (
      s +
      (typeof r.costFinal === "number" ? r.costFinal : r.costFinal.toNumber())
    );
  }, 0);
  return finalCost - partsCost - externalCost;
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
  loanerDevice: true,
  notes: {
    include: {
      createdBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  partsUsed: true,
  partsWaiting: true,
  externalRepairs: {
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { sentAt: "desc" as const },
  },
  payments: { select: { amount: true, method: true, createdAt: true } },
  photos: true,
  repairs: { include: { repair: { select: { warrantyDays: true } } } },
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
    // Latest open external repair — powers the "Externo — X" badge.
    externalRepairs: {
      where: { status: "SENT" as const },
      select: { supplier: { select: { name: true } } },
      take: 1,
      orderBy: { sentAt: "desc" as const },
    },
  } as const satisfies Prisma.JobInclude;

  // List rows never need the heavy/sensitive intake fields — the signature
  // data-URL alone can be ~600KB per job, and unlock codes belong to the
  // detail view only.
  const listOmit = {
    intakeSignatureDataUrl: true,
    deviceUnlockCode: true,
    accessCode: true,
    intakeChecklist: true,
    qcChecklist: true,
  } as const satisfies Prisma.JobOmit;

  const [jobs, totalCount] = await Promise.all([
    jobFindMany(
      prisma,
      where,
      listInclude,
      { id: "desc" },
      limit + 1,
      listOmit
    ),
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
  const [job, deliveredTransitions] = await Promise.all([
    jobFindUnique(prisma, id, JOB_INCLUDE),
    auditFindMany(
      prisma,
      {
        jobId: id,
        action: AuditAction.STATUS_CHANGED,
        toValue: "DELIVERED",
      },
      { createdAt: true },
      { createdAt: "asc" }
    ),
  ]);
  if (!job) {
    return null;
  }

  const finalCost = computeFinalCost(job);
  const { balanceDue, paidTotal } = computeJobBalance(job);
  // Delivery time comes from the audit trail — updatedAt shifts on any
  // later edit, which would reset the warranty clock shown to the user.
  const deliveredAt = deliveredTransitions[0]?.createdAt ?? null;
  return { ...job, balanceDue, deliveredAt, finalCost, paidTotal };
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

/** Phones keep strict IMEI normalization; other equipment stores serials as typed. */
function normalizeIdentifier(
  raw: string,
  category: string | null | undefined
): string {
  return isImeiCategory(category) ? normalizeImei(raw) : raw.trim();
}

/**
 * Device + identifier resolution for job creation: upserts the model
 * (stamping the picked category on new models) and Luhn-checks the IMEI
 * on phones. Null category = legacy row from the phone-only days.
 */
async function resolveJobDevice(
  prisma: PrismaClient,
  brandId: string,
  input: CreateJobInput
) {
  const device = await upsertDevice(
    prisma,
    { brandId_model: { brandId, model: input.deviceModel } },
    input.deviceCategory ? { category: input.deviceCategory } : {},
    {
      brand: { connect: { id: brandId } },
      model: input.deviceModel,
      category: input.deviceCategory ?? null,
    }
  );
  if (
    input.imei &&
    isImeiCategory(device.category) &&
    !isValidImei(input.imei)
  ) {
    return {
      error: "VALIDATION_ERROR" as const,
      errors: { imei: ["validations.imei_invalid"] },
    };
  }
  return {
    device,
    identifier: input.imei
      ? normalizeIdentifier(input.imei, device.category)
      : null,
  };
}

interface JobSignatureData {
  intakeDocumentHash?: string | null;
  intakeSignatureDataUrl: string | null;
  intakeTermsSnapshot?: Prisma.InputJsonValue;
  signedAt?: Date | null;
  signedIp?: string | null;
  signedUserAgent?: string | null;
  signedVia?: string;
}

// In-person signature: the document is rebuilt from the same payload being
// submitted, so the hash on the job proves what was signed.
function inPersonSignatureData(input: CreateJobInput): JobSignatureData {
  if (!input.intakeSignatureDataUrl || input.signatureSessionToken) {
    return { intakeSignatureDataUrl: input.intakeSignatureDataUrl ?? null };
  }
  const document = buildIntakeDocument(
    input,
    input.intakeTermsText ?? "",
    input.intakeLocale ?? "pt"
  );
  return {
    intakeSignatureDataUrl: input.intakeSignatureDataUrl,
    intakeTermsSnapshot: document as unknown as Prisma.InputJsonValue,
    intakeDocumentHash: intakeDocumentHash(
      document,
      input.intakeSignatureDataUrl
    ),
    signedAt: new Date(),
    signedVia: "in_person",
  };
}

// Remote signature: consumes the signed session inside the job transaction —
// the submitted ficha must still match the frozen document, or the link is
// stale and the customer signs a fresh one.
async function remoteSignatureData(
  tx: Pick<PrismaClient, "signatureSession">,
  input: CreateJobInput
): Promise<JobSignatureData | null> {
  if (!input.signatureSessionToken) {
    return null;
  }
  const session = await consumeSignatureSession(
    tx,
    input.signatureSessionToken,
    input
  );
  return {
    intakeSignatureDataUrl: session.signatureDataUrl,
    intakeTermsSnapshot: session.snapshot as unknown as Prisma.InputJsonValue,
    intakeDocumentHash: session.documentHash,
    signedAt: session.signedAt,
    signedVia: "remote",
    signedIp: session.signerIp,
    signedUserAgent: session.signerUserAgent,
  };
}

/** Loaner fields for the create payload — a linked fleet unit implies the
 * loan happened, so the flag/note are never persisted dishonestly. */
function loanerCreateFields(
  input: CreateJobInput,
  checkout: Awaited<ReturnType<typeof checkoutLoanerDevice>> | null
) {
  return {
    hasLoanerDevice: input.hasLoanerDevice || Boolean(checkout),
    loanerDevice: checkout?.connect,
    loanerNote: checkout?.note ?? input.loanerNote ?? null,
  };
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

  const resolved = await resolveJobDevice(prisma, brandId, input);
  if ("error" in resolved) {
    return resolved;
  }
  const { device, identifier: deviceIdentifier } = resolved;

  const { accessCode, jobCode } = await generateJobCode(prisma);

  // Signature provenance — the signature is bound to the document the
  // customer saw: a remote session carries the frozen snapshot (and its
  // signer IP/user-agent), in-person signing snapshots the ficha being
  // submitted. Either way the hash on the job proves the document.
  const signatureData = inPersonSignatureData(input);

  const job = await prisma.$transaction(async (tx) => {
    // Throws SIGNATURE_STALE when the ficha drifted since the link was
    // created — the customer must sign a fresh document.
    const remoteData = await remoteSignatureData(tx, input);

    // Fleet unit checkout — the row lock serializes simultaneous intakes so
    // the same unit can never be handed out twice at once.
    const checkout = input.loanerDeviceId
      ? await checkoutLoanerDevice(tx, input.loanerDeviceId, input.loanerNote)
      : null;

    const created = await jobCreateJob(
      tx,
      {
        accessCode,
        accessories: input.accessories ?? [],
        color: input.color ?? null,
        conditionNotes: input.conditionNotes ?? null,
        deviceUnlockCode: input.deviceUnlockCode ?? null,
        intakeChecklist: input.intakeChecklist ?? undefined,
        ...(remoteData ?? signatureData),
        createdBy: { connect: { id: userId } },
        customer: { connect: { id: customer.id } },
        imei: deviceIdentifier,
        depositAmount: input.depositAmount ?? null,
        ...loanerCreateFields(input, checkout),
        device: { connect: { id: device.id } },
        estimatedCost: input.estimatedCost,
        estimatedDate: input.estimatedDate
          ? new Date(input.estimatedDate)
          : null,
        isUrgent: input.isUrgent ?? false,
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
  }).catch((err) => {
    // Fire-and-forget on purpose — but never invisible.
    logger.warn(
      { err, eventName: "job_created", jobId: job.id },
      "notify dispatch failed"
    );
  });

  const fullJob = await jobFindUnique(prisma, job.id, JOB_INCLUDE);

  return { ...(fullJob ?? job), finalCost: computeFinalCost(fullJob ?? job) };
}

const GENERIC_IMPORT_BRAND = "Outra";

export interface ImportedJobInput {
  createdAt?: string;
  customerEmail?: string;
  customerName: string;
  customerPhone: string;
  deliveredAt?: string;
  deviceBrand?: string;
  deviceModel: string;
  externalRef?: string;
  jobCode?: string;
  problem: string;
  status?: JobStatusType;
}

/**
 * Historical import (CSV/Excel migrations from another system). Shares the
 * normal creation path pieces — normalized-phone customer match,
 * case-insensitive brand, device upsert — but skips signatures and
 * notifications, and carries the legacy dates over: the job's createdAt and,
 * for DELIVERED history, a STATUS_CHANGED audit row stamped at deliveredAt
 * so the export's deliveredAt round-trips.
 */
export function createImportedJob(
  prisma: PrismaClient,
  input: ImportedJobInput,
  userId: string
) {
  const status = input.status ?? "DELIVERED";
  const createdAt = input.createdAt ? new Date(input.createdAt) : undefined;
  const deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : null;

  return prisma.$transaction(async (tx) => {
    const customer =
      (await findByNormalizedPhone(tx, normalizePhone(input.customerPhone))) ??
      (await tx.customer.create({
        data: {
          name: input.customerName.trim(),
          phone: input.customerPhone.trim(),
          email: input.customerEmail?.trim() || null,
        },
      }));

    const brandName = input.deviceBrand?.trim() || GENERIC_IMPORT_BRAND;
    const brand =
      (await findBrandFirst(tx, {
        name: { equals: brandName, mode: "insensitive" },
      })) ?? (await createBrand(tx, { name: brandName }));

    const device = await upsertDevice(
      tx,
      { brandId_model: { brandId: brand.id, model: input.deviceModel } },
      {},
      {
        brand: { connect: { id: brand.id } },
        model: input.deviceModel,
        category: null,
      }
    );

    const jobCode =
      input.jobCode ?? (await generateJobCode(tx as PrismaClient)).jobCode;
    const accessCode = crypto.randomBytes(8).toString("hex");

    const job = await tx.job.create({
      data: {
        jobCode,
        accessCode,
        externalRef: input.externalRef ?? null,
        customerId: customer.id,
        deviceId: device.id,
        reportedProblem: input.problem.trim(),
        status,
        createdById: userId,
        ...(createdAt ? { createdAt } : {}),
      },
    });

    await createAuditLog(tx, {
      action: AuditAction.JOB_CREATED,
      jobId: job.id,
      toValue: jobCode,
      userId,
      ...(createdAt ? { createdAt } : {}),
    });

    if ((status === "DELIVERED" || deliveredAt) && deliveredAt) {
      await createAuditLog(tx, {
        action: AuditAction.STATUS_CHANGED,
        jobId: job.id,
        toValue: "DELIVERED",
        userId,
        createdAt: deliveredAt,
      });
    }

    return job;
  });
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

function buildJobUpdateData(
  input: UpdateJobInput,
  deviceCategory: string | null | undefined
): Prisma.JobUpdateInput {
  const {
    depositAmount,
    estimatedDate,
    imei,
    intakeChecklist,
    loanerDeviceId,
    technicianId,
    ...rest
  } = input;
  const data: Prisma.JobUpdateInput = { ...rest };

  if (intakeChecklist !== undefined) {
    data.intakeChecklist =
      intakeChecklist === null ? Prisma.JsonNull : intakeChecklist;
  }

  if (imei !== undefined) {
    data.imei = imei ? normalizeIdentifier(imei, deviceCategory) : null;
  }

  if (estimatedDate === null) {
    data.estimatedDate = null;
  } else if (estimatedDate) {
    data.estimatedDate = new Date(estimatedDate);
  }

  if (depositAmount === null) {
    data.depositAmount = null;
  } else if (depositAmount !== undefined) {
    data.depositAmount = depositAmount;
  }

  if (technicianId === null) {
    data.technician = { disconnect: true };
  } else if (technicianId) {
    data.technician = { connect: { id: technicianId } };
  }

  // Re-linking a unit opens a fresh loan — a stale return stamp would make
  // the new loan look already closed. Disconnecting keeps the stamp: an open
  // loan can't be disconnected at all (guarded in update()), so a surviving
  // stamp is a true record of when the unit came back.
  if (loanerDeviceId === null) {
    data.loanerDevice = { disconnect: true };
  } else if (loanerDeviceId) {
    data.loanerDevice = { connect: { id: loanerDeviceId } };
    data.loanerReturnedAt = null;
  }

  return data;
}

// The resulting loan state — a linked fleet unit *is* a loan, so the flag
// can never contradict it and an open loan can't be silently disconnected
// (the unit must be marked returned first, which leaves an audit trail).
function validateLoanerUpdate(
  job: Pick<Job, "hasLoanerDevice" | "loanerDeviceId" | "loanerReturnedAt">,
  input: UpdateJobInput,
  data: Prisma.JobUpdateInput
): { error: "VALIDATION_ERROR"; errors: Record<string, string[]> } | null {
  const linkedAfter =
    input.loanerDeviceId === undefined
      ? job.loanerDeviceId
      : input.loanerDeviceId;
  if (
    input.loanerDeviceId === null &&
    job.loanerDeviceId &&
    !job.loanerReturnedAt
  ) {
    return {
      error: "VALIDATION_ERROR",
      errors: { loanerDeviceId: ["validations.loaner_disconnect_open"] },
    };
  }
  if (linkedAfter && input.hasLoanerDevice === false) {
    return {
      error: "VALIDATION_ERROR",
      errors: { hasLoanerDevice: ["validations.loaner_flag_linked"] },
    };
  }
  if (
    linkedAfter &&
    input.hasLoanerDevice === undefined &&
    !job.hasLoanerDevice
  ) {
    data.hasLoanerDevice = true;
  }
  return null;
}

// Fleet reassignment — same serialization as intake: the unit row is locked
// before the availability check runs. A new unit means a new printable
// identity: an omitted note always regenerates from the fleet row (a custom
// note comes in the same PATCH).
async function applyLoanerReassignment(
  tx: DbClient,
  input: UpdateJobInput,
  jobId: string,
  data: Prisma.JobUpdateInput
) {
  if (!input.loanerDeviceId) {
    return;
  }
  await tx.$queryRaw`SELECT "id" FROM "loaner_devices" WHERE "id" = ${input.loanerDeviceId} FOR UPDATE`;
  await assertLoanerAssignable(tx, input.loanerDeviceId, jobId);
  if (input.loanerNote !== undefined) {
    return;
  }
  const device = await tx.loanerDevice.findUniqueOrThrow({
    where: { id: input.loanerDeviceId },
  });
  data.loanerNote = describeLoanerDevice(device);
}

// A unit swap isn't a physical return, but it does free the previous unit —
// record which units were detached/attached or the fleet loses the trail.
async function auditLoanerUnitChange(
  prisma: PrismaClient,
  job: Pick<Job, "loanerDeviceId">,
  input: UpdateJobInput,
  jobId: string,
  userId: string
) {
  if (
    input.loanerDeviceId === undefined ||
    input.loanerDeviceId === (job.loanerDeviceId ?? null)
  ) {
    return;
  }
  await createAuditLog(prisma, {
    action: AuditAction.JOB_UPDATED,
    fromValue: job.loanerDeviceId ?? undefined,
    jobId,
    note: "Loaner unit changed",
    toValue: input.loanerDeviceId ?? undefined,
    userId,
  });
}

export interface AssignAccess {
  canAssign: boolean;
  canSelfAssign: boolean;
}

const NO_ASSIGN_ACCESS: AssignAccess = {
  canAssign: false,
  canSelfAssign: false,
};

// jobs:assign may set any technician; jobs:selfAssign may only claim an
// unassigned job for the caller.
function assertAssignmentAllowed(
  currentTechnicianId: string | null,
  nextTechnicianId: string | null | undefined,
  userId: string,
  access: AssignAccess
) {
  if (
    nextTechnicianId === undefined ||
    nextTechnicianId === currentTechnicianId ||
    access.canAssign
  ) {
    return null;
  }
  const isSelfClaim =
    access.canSelfAssign &&
    currentTechnicianId === null &&
    nextTechnicianId === userId;
  return isSelfClaim ? null : { error: "FORBIDDEN" as const };
}

// Compare-and-set on the technician the permission check was made against:
// the row lock serializes concurrent edits, and a changed value aborts.
async function lockTechnicianSnapshot(
  tx: DbClient,
  jobId: string,
  checkedTechnicianId: string | null
) {
  const { count } = await tx.job.updateMany({
    where: { id: jobId, technicianId: checkedTechnicianId },
    data: { updatedAt: new Date() },
  });
  if (count === 0) {
    throw new AppError("CONFLICT");
  }
}

async function checkTechnicianChange(
  prisma: PrismaClient,
  currentTechnicianId: string | null,
  nextTechnicianId: string | null | undefined,
  userId: string,
  access: AssignAccess
) {
  const assignError = assertAssignmentAllowed(
    currentTechnicianId,
    nextTechnicianId,
    userId,
    access
  );
  if (assignError || !nextTechnicianId) {
    return assignError;
  }
  return await validateTechnician(prisma, nextTechnicianId);
}

export async function update(
  prisma: PrismaClient,
  id: string,
  input: UpdateJobInput,
  userId: string,
  assignAccess: AssignAccess = NO_ASSIGN_ACCESS
) {
  const job = await findUniqueSimple(prisma, id);
  if (!job) {
    return null;
  }
  const mutabilityError = assertJobMutable(job);
  if (mutabilityError) {
    return mutabilityError;
  }

  const technicianError = await checkTechnicianChange(
    prisma,
    job.technicianId ?? null,
    input.technicianId,
    userId,
    assignAccess
  );
  if (technicianError) {
    return technicianError;
  }

  let deviceCategory: string | null | undefined;
  if (input.imei) {
    const device = await prisma.device.findUnique({
      where: { id: job.deviceId },
      select: { category: true },
    });
    deviceCategory = device?.category;
    if (isImeiCategory(deviceCategory) && !isValidImei(input.imei)) {
      return {
        error: "VALIDATION_ERROR" as const,
        errors: { imei: ["validations.imei_invalid"] },
      };
    }
  }

  const data = buildJobUpdateData(input, deviceCategory);

  const { technicianId } = input;

  const loanerError = validateLoanerUpdate(job, input, data);
  if (loanerError) {
    return loanerError;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (technicianId !== undefined) {
      await lockTechnicianSnapshot(tx, id, job.technicianId ?? null);
    }
    await applyLoanerReassignment(tx, input, id, data);
    return await jobUpdate(tx, id, data, JOB_INCLUDE);
  });

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

  await auditLoanerUnitChange(prisma, job, input, id, userId);

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

interface TransitionArgs {
  fromStatus: string;
  newStatus: JobStatusType;
  payment?: { amount: number; method: PaymentMethodType };
  reason?: string;
  techAssigned: boolean;
  updateData: Prisma.JobUpdateInput;
  userId: string;
}

// Runs inside the transition transaction under the job lock: refuses
// delivery while an external repair is still out (a send created
// concurrently is seen or blocked instead of racing past), and records an
// optional handover payment against the locked balance — atomically with
// the status change, so a refused delivery leaves nothing behind.
async function assertHandover(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  payment?: { amount: number; method: PaymentMethodType }
) {
  const openExternal = await tx.externalRepair.findFirst({
    where: { jobId: id, status: "SENT" },
    select: { id: true },
  });
  if (openExternal) {
    throw new AppError("CONFLICT_STATUS_TRANSITION", {
      blockedBy: "EXTERNAL_REPAIR_OPEN",
    });
  }
  if (!payment) {
    return;
  }
  const balanceJob = await tx.job.findUnique({
    where: { id },
    select: {
      depositAmount: true,
      payments: { select: { amount: true } },
      partsUsed: { select: { totalCost: true } },
      repairs: { select: { price: true } },
    },
  });
  if (!balanceJob) {
    throw new AppError("JOB_NOT_FOUND");
  }
  const { balanceDue } = computeJobBalance(balanceJob);
  if (payment.amount > balanceDue) {
    throw new AppError("PAYMENT_EXCEEDS_BALANCE", { balanceDue });
  }
  const created = await createPaymentRepo(tx, {
    amount: payment.amount,
    job: { connect: { id } },
    method: payment.method,
    note: null,
    reference: null,
    createdBy: { connect: { id: userId } },
  });
  await createAuditLog(tx, {
    action: AuditAction.PAYMENT_ADDED,
    jobId: id,
    metadata: {
      autoSource: "DELIVERY",
      method: payment.method,
      paymentId: created.id,
    },
    toValue: `${payment.amount} ${payment.method}`,
    userId,
  });
}

async function applyTransition(
  prisma: PrismaClient,
  id: string,
  args: TransitionArgs
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize concurrent transitions and re-check the status under the
      // lock: the flow validation above ran on a pre-lock snapshot, so
      // without this a raced transition could apply on top of a newer state.
      await tx.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${id} FOR UPDATE`;
      const fresh = await tx.job.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!fresh || fresh.status !== args.fromStatus) {
        throw new AppError("CONFLICT_STATUS_TRANSITION");
      }

      if (args.newStatus === JobStatus.DELIVERED) {
        await assertHandover(tx, id, args.userId, args.payment);
      }

      const updatedJob = await jobUpdate(tx, id, args.updateData, JOB_INCLUDE);

      await createAuditLog(tx, {
        action: AuditAction.STATUS_CHANGED,
        fromValue: args.fromStatus,
        jobId: id,
        metadata: args.reason ? { reason: args.reason } : undefined,
        note: args.reason,
        toValue: args.newStatus,
        userId: args.userId,
      });

      if (args.techAssigned) {
        await createAuditLog(tx, {
          action: AuditAction.TECHNICIAN_ASSIGNED,
          fromValue: undefined,
          jobId: id,
          toValue: args.userId,
          userId: args.userId,
        });
      }

      return updatedJob;
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === "CONFLICT_STATUS_TRANSITION"
    ) {
      const current = await findUniqueSimple(prisma, id);
      const flow = current
        ? (JOB_STATUS_FLOW[current.status as JobStatusType] ?? [])
        : [];
      // An open external repair blocks DELIVERED specifically — advertising
      // it as an allowed alternative would contradict the refusal.
      const blockedBy = (error.details as { blockedBy?: string } | undefined)
        ?.blockedBy;
      return {
        allowedTransitions:
          blockedBy === "EXTERNAL_REPAIR_OPEN"
            ? flow.filter((s) => s !== JobStatus.DELIVERED)
            : flow,
        currentStatus: current?.status,
        error: "CONFLICT_STATUS_TRANSITION" as const,
      };
    }
    throw error;
  }
}

function buildTransitionUpdateData(
  job: {
    hasLoanerDevice: boolean;
    status: string;
    technicianId: string | null;
  },
  newStatus: JobStatusType,
  userId: string,
  options?: {
    loanerReturned?: boolean;
    reason?: string;
    actualLaborHours?: number;
    qcChecklist?: Record<string, "ok" | "fail" | null>;
  }
): { updateData: Prisma.JobUpdateInput; techAssigned: boolean } {
  const updateData: Prisma.JobUpdateInput = {
    status: newStatus,
    updatedBy: { connect: { id: userId } },
  };

  if (newStatus === JobStatus.ON_HOLD && options?.reason) {
    updateData.holdReason = options.reason;
  } else if (job.status === JobStatus.ON_HOLD) {
    updateData.holdReason = null;
  }

  if (newStatus === JobStatus.DONE) {
    if (options?.actualLaborHours !== undefined) {
      updateData.actualLaborHours = options.actualLaborHours;
    }
    if (options?.qcChecklist) {
      updateData.qcChecklist = options.qcChecklist;
    }
  }

  // The unit physically came back as the customer picks up (DELIVERED) or
  // takes the device unrepaired (RETURNED). Unchecked stays "out" — the
  // customer may return it later via the loaners board.
  if (
    options?.loanerReturned &&
    job.hasLoanerDevice &&
    (newStatus === JobStatus.DELIVERED || newStatus === JobStatus.RETURNED)
  ) {
    updateData.loanerReturnedAt = new Date();
  }

  const techAssigned = newStatus === JobStatus.IN_REPAIR && !job.technicianId;
  if (techAssigned) {
    updateData.technician = { connect: { id: userId } };
  }

  return { updateData, techAssigned };
}

export async function transitionStatus(
  prisma: PrismaClient,
  id: string,
  newStatus: JobStatusType,
  userId: string,
  notifyCtx: NotifyContext,
  options?: {
    loanerReturned?: boolean;
    payment?: { amount: number; method: PaymentMethodType };
    reason?: string;
    requestingRole: RoleType;
    actualLaborHours?: number;
    qcChecklist?: Record<string, "ok" | "fail" | null>;
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

  // A handover payment only makes sense on the DELIVERED transition —
  // anywhere else it would record money against a job still in progress.
  if (options?.payment && newStatus !== JobStatus.DELIVERED) {
    return { error: "VALIDATION_ERROR" as const };
  }

  const { updateData, techAssigned } = buildTransitionUpdateData(
    job,
    newStatus,
    userId,
    options
  );

  const applied = await applyTransition(prisma, id, {
    fromStatus: job.status,
    newStatus,
    payment: options?.payment,
    reason: options?.reason,
    techAssigned,
    updateData,
    userId,
  });
  if ("error" in applied) {
    return applied;
  }
  const updated = applied;

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
    }).catch((err) => {
      logger.warn(
        { err, eventName: templateName, jobId: id },
        "notify dispatch failed"
      );
    });
  }

  // The stamped return is its own audit event — the STATUS_CHANGED row only
  // proves the job moved, not that the unit came back.
  if (
    options?.loanerReturned &&
    job.hasLoanerDevice &&
    (newStatus === JobStatus.DELIVERED || newStatus === JobStatus.RETURNED)
  ) {
    await createAuditLog(prisma, {
      action: AuditAction.LOANER_RETURNED,
      jobId: id,
      toValue: job.loanerDeviceId ?? job.loanerNote ?? undefined,
      userId,
    });
  }

  // One-click paid-on-delivery: record the outstanding balance now that
  // the job reached DELIVERED. Best-effort — never blocks the transition.
  if (newStatus === JobStatus.DELIVERED) {
    try {
      await settlePaymentOnDelivery(prisma, id, userId);
    } catch {
      // surfaced via the payments section; delivery must not fail
    }
  }

  return { ...updated, finalCost: computeFinalCost(updated) };
}

// Only the latest actionable quote is exposed — SUPERSEDED rows are internal
// bookkeeping for the revise-and-resend flow.
const LOOKUP_INCLUDE_QUOTES = {
  where: { status: { not: "SUPERSEDED" as const } },
  orderBy: { version: "desc" as const },
  take: 1,
  select: {
    id: true,
    version: true,
    amount: true,
    note: true,
    status: true,
    sentAt: true,
    respondedAt: true,
    responseNote: true,
  },
} as const;

const LOOKUP_INCLUDE_PUBLIC = {
  customer: { select: { name: true, phone: true } },
  device: { select: { model: true, brand: { select: { name: true } } } },
  repairs: {
    select: {
      repairName: true,
      price: true,
      repair: { select: { warrantyDays: true } },
    },
  },
  partsUsed: { select: { partName: true, quantity: true, totalCost: true } },
  payments: { select: { amount: true, method: true, createdAt: true } },
  notes: {
    where: { isCustomerVisible: true },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
  quotes: LOOKUP_INCLUDE_QUOTES,
} as const;

const LOOKUP_INCLUDE_AUTH = {
  customer: { select: { name: true } },
  device: { select: { model: true, brand: { select: { name: true } } } },
  repairs: {
    select: {
      repairName: true,
      price: true,
      repair: { select: { warrantyDays: true } },
    },
  },
  partsUsed: { select: { partName: true, quantity: true, totalCost: true } },
  payments: { select: { amount: true, method: true, createdAt: true } },
  notes: {
    where: { isCustomerVisible: true },
    select: { content: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
  quotes: LOOKUP_INCLUDE_QUOTES,
} as const;

async function buildJobLookupPayload(
  prisma: PrismaClient,
  jobId: string,
  // Anonymous tracking masks the customer name; staff and portal lookups
  // keep it whole — pass maskCustomer: false there.
  options: { maskCustomer: boolean },
  job: {
    jobCode: string;
    status: string;
    reportedProblem: string;
    estimatedCost?: number | { toNumber: () => number } | null;
    depositAmount?: number | { toNumber: () => number } | null;
    estimatedDate: Date | null;
    createdAt: Date;
    customer: { name: string };
    device: { brand: { name: string }; model: string };
    notes: Array<{ content: string; createdAt: Date }>;
    repairs: Array<{
      repairName: string;
      price: { toNumber: () => number };
      repair?: { warrantyDays: number | null } | null;
    }>;
    partsUsed?: Array<{
      partName: string;
      quantity: number;
      totalCost: { toNumber: () => number };
    }>;
    payments?: Array<{
      amount: { toNumber: () => number };
      method: string;
      createdAt: Date | string;
    }>;
    quotes: Array<{
      id: string;
      version: number;
      amount: { toNumber: () => number };
      note: string | null;
      status: string;
      sentAt: Date;
      respondedAt: Date | null;
      responseNote: string | null;
    }>;
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

  const latestQuote = job.quotes[0] ?? null;

  // Digital receipt + warranty: same totals the printed receipt shows, and
  // per-repair warranty expiry counted from the DELIVERED transition.
  const num = (v: number | { toNumber: () => number }) =>
    typeof v === "number" ? v : v.toNumber();

  const deliveredAt =
    statusTransitions.find((t) => t.toValue === "DELIVERED")?.createdAt ?? null;
  const defaultWarrantyDays = shopSettings?.defaultWarrantyDays ?? 30;
  const warranty = {
    deliveredAt,
    items: job.repairs.map((r) => {
      const days = r.repair?.warrantyDays ?? defaultWarrantyDays;
      return {
        days,
        name: r.repairName,
        validUntil: deliveredAt
          ? new Date(deliveredAt.getTime() + days * 86_400_000)
          : null,
      };
    }),
  };

  const partsUsed = job.partsUsed ?? [];
  const payments = job.payments ?? [];
  const receiptItems = [
    ...job.repairs.map((r) => ({
      name: r.repairName,
      price: r.price.toNumber(),
      quantity: 1,
    })),
    ...partsUsed.map((p) => ({
      name: p.partName,
      price: p.totalCost.toNumber(),
      quantity: p.quantity,
    })),
  ];
  let receiptTotal = 0;
  if (receiptItems.length > 0) {
    receiptTotal = receiptItems.reduce((s, i) => s + i.price, 0);
  } else if (job.estimatedCost) {
    receiptTotal = num(job.estimatedCost);
  }
  const receiptDeposit = job.depositAmount ? num(job.depositAmount) : 0;
  const receiptPaid =
    payments.reduce((s, p) => s + p.amount.toNumber(), 0) + receiptDeposit;

  return {
    createdAt: job.createdAt,
    // Public tracking: code + phone4 already proves ownership, so the payload
    // stays minimal — first name + last initial only, never a contact field.
    customer: {
      name: options.maskCustomer
        ? maskCustomerName(job.customer.name)
        : job.customer.name,
    },
    receipt: {
      balanceDue: Math.max(0, receiptTotal - receiptPaid),
      currency: shopSettings?.currency ?? "EUR",
      deposit: receiptDeposit,
      items: receiptItems,
      paid: receiptPaid,
      payments: payments.map((p) => ({
        amount: p.amount.toNumber(),
        createdAt: p.createdAt,
        method: p.method,
      })),
      total: receiptTotal,
    },
    warranty,
    quote: latestQuote
      ? {
          id: latestQuote.id,
          version: latestQuote.version,
          amount: latestQuote.amount.toNumber(),
          note: latestQuote.note,
          status: latestQuote.status,
          sentAt: latestQuote.sentAt,
          respondedAt: latestQuote.respondedAt,
          responseNote: latestQuote.responseNote,
        }
      : null,
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
          ...toPublicShop(shopSettings),
          reviewUrl: shopSettings.reviewUrl,
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

const NAME_SPLIT_RE = /\s+/;

/** "Ana Maria Silva" → "Ana S." — enough to reassure, nothing to harvest. */
function maskCustomerName(name: string): string {
  const parts = name.trim().split(NAME_SPLIT_RE).filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  const last = parts.at(-1);
  if (parts.length === 1 || !last) {
    return parts[0];
  }
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

function customerPhoneMatches(phone: string | null, phone4: string): boolean {
  if (!phone) {
    return false;
  }
  const normalizedPhone = phone.replace(/\D/g, "");
  return normalizedPhone.length >= 4 && normalizedPhone.slice(-4) === phone4;
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

  if (!customerPhoneMatches(job.customer.phone, phone4)) {
    return { job: null, jobExists: true };
  }

  const payload = await buildJobLookupPayload(
    prisma,
    job.id,
    { maskCustomer: true },
    job as unknown as Parameters<typeof buildJobLookupPayload>[3]
  );
  return { jobExists: true, job: payload };
}

const LOOKUP_INCLUDE_RECEIPT = {
  intakeDocumentHash: true,
  signedAt: true,
  customer: { select: { name: true, phone: true } },
  device: { select: { model: true, brand: { select: { name: true } } } },
  payments: { select: { amount: true, method: true, createdAt: true } },
  partsUsed: { select: { partName: true, quantity: true, totalCost: true } },
  repairs: {
    select: {
      repairName: true,
      price: true,
      repair: { select: { warrantyDays: true } },
    },
  },
} as const;

/**
 * Same code + phone4 proof as the tracking lookup, returning the raw job
 * shape renderReceiptHtml consumes for the customer's digital receipt.
 */
export async function lookupReceiptByCode(
  prisma: PrismaClient,
  jobCode: string,
  phone4: string
): Promise<{ job: unknown | null; jobExists: boolean }> {
  const job = await jobFindFirst(prisma, { jobCode }, LOOKUP_INCLUDE_RECEIPT);
  if (!job) {
    return { job: null, jobExists: false };
  }
  if (!customerPhoneMatches(job.customer.phone, phone4)) {
    return { job: null, jobExists: true };
  }
  return { job, jobExists: true };
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
    { maskCustomer: false },
    job as unknown as Parameters<typeof buildJobLookupPayload>[3]
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

export async function getJobHistory(prisma: PrismaClient, jobId: string) {
  const entries = await auditFindManyWithInclude(
    prisma,
    { jobId },
    { user: { select: { id: true, name: true, role: true } } },
    { createdAt: "desc" }
  );
  return resolveTechnicianNames(prisma, entries);
}
