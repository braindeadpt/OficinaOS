import { Prisma, type PrismaClient } from "@generated/client";
import { AppError } from "@shared/errors/app-error.js";
import type {
  CreateTradeInInput,
  UpdateTradeInInput,
} from "@shared/schemas/trade-in.schema.js";
import {
  count,
  create,
  findMany,
  findUnique,
  update,
} from "../repositories/trade-in.repository.js";
import { generateTradeInCode } from "../utils/trade-in-code.js";

const PAGE_SIZE_MAX = 100;

export interface TradeInListParams {
  limit?: number;
  page?: number;
  status?: string;
}

export async function listTradeIns(
  prisma: PrismaClient,
  params: TradeInListParams
) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, params.limit ?? 20));
  const where = params.status ? { status: params.status as never } : {};
  const [items, total] = await Promise.all([
    findMany(prisma, where, { createdAt: "desc" }, (page - 1) * limit, limit),
    count(prisma, where),
  ]);
  return { items, limit, page, total };
}

export async function getTradeIn(prisma: PrismaClient, id: string) {
  const tradeIn = await findUnique(prisma, id);
  if (!tradeIn) {
    throw new AppError("TRADE_IN_NOT_FOUND");
  }
  return tradeIn;
}

export async function createTradeIn(
  prisma: PrismaClient,
  input: CreateTradeInInput,
  createdById: string
) {
  const customer = await prisma.customer.findUnique({
    select: { id: true },
    where: { id: input.customerId },
  });
  if (!customer) {
    throw new AppError("CUSTOMER_NOT_FOUND");
  }
  const code = await generateTradeInCode(prisma);
  return await create(prisma, {
    code,
    condition: input.condition,
    createdById,
    customerId: input.customerId,
    deviceBrand: input.deviceBrand,
    deviceModel: input.deviceModel,
    functionalChecklist: input.functionalChecklist
      ? JSON.parse(JSON.stringify(input.functionalChecklist))
      : undefined,
    imei: input.imei,
    notes: input.notes,
    paymentMethod: input.paymentMethod,
    purchasePrice: input.purchasePrice,
    sellerIdNumber: input.sellerIdNumber,
    sellerIdType: input.sellerIdType,
    signatureDataUrl: input.signatureDataUrl,
    storage: input.storage,
  });
}

/** Edits are only allowed while the offer hasn't been decided yet. */
export async function updateTradeIn(
  prisma: PrismaClient,
  id: string,
  input: UpdateTradeInInput
) {
  const tradeIn = await getTradeIn(prisma, id);
  if (tradeIn.status !== "OFFERED") {
    throw new AppError("TRADE_IN_INVALID_STATE");
  }
  return await update(prisma, id, {
    ...input,
    functionalChecklist: checklistForDb(input.functionalChecklist),
  });
}

function checklistForDb(value: UpdateTradeInInput["functionalChecklist"]) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  return JSON.parse(JSON.stringify(value));
}

const TRANSITIONS: Record<string, string[]> = {
  OFFERED: ["PURCHASED", "CANCELLED"],
  PURCHASED: ["SOLD"],
};

export async function transitionTradeIn(
  prisma: PrismaClient,
  id: string,
  target: string
) {
  const tradeIn = await getTradeIn(prisma, id);
  if (!(TRANSITIONS[tradeIn.status] ?? []).includes(target)) {
    throw new AppError("TRADE_IN_INVALID_STATE");
  }
  // The signed receipt is the legal proof of the purchase — a trade-in
  // cannot become PURCHASED without the seller's signature on file.
  if (target === "PURCHASED" && !tradeIn.signatureDataUrl) {
    throw new AppError("TRADE_IN_SIGNATURE_REQUIRED");
  }
  return await update(prisma, id, { status: target as never });
}
