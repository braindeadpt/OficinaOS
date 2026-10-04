import type { PrismaClient } from "@generated/client";
import { IntakeRequestStatus } from "@generated/client";
import { Role } from "@shared/constants/roles.js";
import { AppError } from "@shared/errors/app-error.js";
import type { PreCheckSubmitInput } from "@shared/schemas/intake-request.schema";
import { decryptSecret } from "../lib/crypto.js";
import { update as customerUpdate } from "../repositories/customer.repository.js";
import {
  create,
  findMany,
  findUnique,
  update,
} from "../repositories/intake-request.repository.js";
import { findUniqueSimple } from "../repositories/job.repository.js";
import { findManyUsers } from "../repositories/notification.repository.js";
import { generateIntakeRequestCode } from "../utils/intake-request-code.js";
import { cloudFetch } from "./cloud.service.js";
import type { NotifyContext } from "./job.service.js";
import { notify } from "./notification-dispatch.js";

const LIST_TAKE = 100;

/**
 * Public pre-check submission — also the shape the future hosted Pro relay
 * will create for inbound WhatsApp, so staff sees a single request type
 * regardless of origin.
 */
export async function submitPreCheckRequest(
  prisma: PrismaClient,
  input: PreCheckSubmitInput,
  notifyCtx: NotifyContext
) {
  const code = await generateIntakeRequestCode(prisma);

  const request = await create(prisma, {
    code,
    customerEmail: input.customerEmail || null,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    deviceLabel: input.deviceLabel,
    problem: input.problem,
    scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
    whatsappOptIn: input.whatsappOptIn ?? false,
  });

  // Front desk and owners both handle intake — resolve the userIds so every
  // staff role that can convert a request sees the alert.
  findManyUsers(
    prisma,
    { isActive: true, role: { in: [Role.OWNER, Role.FRONT_DESK] } },
    { id: true }
  )
    .then((users) =>
      users.length
        ? notify(notifyCtx, {
            context: {
              customerName: request.customerName,
              deviceLabel: request.deviceLabel,
              requestCode: request.code,
            },
            eventName: "pre_check_submitted",
            recipients: { userIds: users.map((u) => u.id) },
          })
        : undefined
    )
    .catch(() => {
      /* fire-and-forget */
    });

  return request;
}

export async function listIntakeRequests(
  prisma: PrismaClient,
  status?: keyof typeof IntakeRequestStatus
) {
  return await findMany(
    prisma,
    status ? { status } : {},
    { createdAt: "desc" },
    LIST_TAKE
  );
}

export async function dismissIntakeRequest(prisma: PrismaClient, id: string) {
  const request = await findUnique(prisma, id);
  if (!request) {
    throw new AppError("INTAKE_REQUEST_NOT_FOUND");
  }
  if (request.status !== IntakeRequestStatus.PENDING) {
    throw new AppError("INTAKE_REQUEST_NOT_PENDING");
  }
  return await update(prisma, id, { status: IntakeRequestStatus.DISMISSED });
}

/**
 * Links the request to the job the staff just created through the normal
 * intake flow. A PENDING check makes the convert idempotent — double-clicking
 * "Create job" can't attach two jobs to the same request.
 */
export async function convertIntakeRequest(
  prisma: PrismaClient,
  id: string,
  jobId: string
) {
  const request = await findUnique(prisma, id);
  if (!request) {
    throw new AppError("INTAKE_REQUEST_NOT_FOUND");
  }
  if (request.status !== IntakeRequestStatus.PENDING) {
    throw new AppError("INTAKE_REQUEST_NOT_PENDING");
  }

  const job = await findUniqueSimple(prisma, jobId);
  if (!job) {
    throw new AppError("JOB_NOT_FOUND");
  }

  // Consent the customer granted on the public form flows to the record the
  // job just created — this is the lawful opt-in WhatsApp delivery needs.
  if (request.whatsappOptIn) {
    await customerUpdate(prisma, job.customerId, {
      whatsappConsent: true,
      whatsappConsentAt: new Date(),
    });
  }

  return await update(prisma, id, {
    job: { connect: { id: jobId } },
    status: IntakeRequestStatus.CONVERTED,
  });
}

const AI_REPORT_TIMEOUT_MS = 150_000;
const REPORT_LANGS = new Set(["pt", "en", "fr", "es"]);

interface IntakeDiagnostic {
  device?: {
    brand?: string;
    model?: string;
    os?: string;
    osVersion?: string;
  };
  notes?: string;
  purpose?: "repair" | "sale";
  results?: Record<string, unknown>;
}

/**
 * Shop-side AI report: the paired shop token calls the cloud Pro module
 * (ai-reports) so the report lands on this request. Idempotent — a stored
 * report is returned without spending another generation.
 */
export async function generateIntakeAiReport(
  prisma: PrismaClient,
  id: string,
  locale?: string
) {
  const request = await findUnique(prisma, id);
  if (!request) {
    throw new AppError("INTAKE_REQUEST_NOT_FOUND");
  }
  if (request.aiReport) {
    return request;
  }

  const diagnostic = request.diagnostic as IntakeDiagnostic | null;
  if (!diagnostic?.results) {
    throw new AppError("INTAKE_REQUEST_NO_DIAGNOSTIC");
  }

  const settings = await prisma.shopSettings.findUniqueOrThrow({
    where: { id: "default" },
  });
  if (!(settings.cloudApiUrl && settings.cloudShopTokenEncrypted)) {
    throw new AppError("CLOUD_NOT_PAIRED");
  }
  const token = decryptSecret(settings.cloudShopTokenEncrypted);

  const lang = REPORT_LANGS.has(locale ?? "") ? (locale as string) : "pt";
  const res = await cloudFetch(settings.cloudApiUrl, "/reports/diagnostic", {
    body: {
      device: diagnostic.device ?? {},
      lang,
      notes: diagnostic.notes,
      purpose: diagnostic.purpose,
      results: diagnostic.results,
    },
    method: "POST",
    timeoutMs: AI_REPORT_TIMEOUT_MS,
    token,
  });
  if (!res.ok) {
    const code = (res.body as { error?: { code?: string } } | null)?.error
      ?.code;
    if (code === "AI_NOT_CONFIGURED") {
      throw new AppError("AI_NOT_CONFIGURED");
    }
    throw new AppError("CLOUD_AI_FAILED");
  }

  const report = (res.body as { report?: string } | null)?.report;
  if (!report) {
    throw new AppError("CLOUD_AI_FAILED");
  }
  return await update(prisma, id, { aiReport: report });
}
