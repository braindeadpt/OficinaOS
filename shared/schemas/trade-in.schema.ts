import { z } from "zod";

const SELLER_ID_TYPES = ["CC", "PASSPORT", "NIF", "OTHER"] as const;
const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
const PAYMENT_METHODS = ["CASH", "TRANSFER", "STORE_CREDIT"] as const;

export const tradeInFunctionalChecklistSchema = z.record(
  z.string().min(1).max(30),
  z.enum(["ok", "fail"])
);

export const createTradeInSchema = z
  .object({
    customerId: z.string().min(1),
    sellerIdType: z.enum(SELLER_ID_TYPES),
    sellerIdNumber: z.string().min(4).max(30),
    deviceBrand: z.string().min(1).max(60),
    deviceModel: z.string().min(1).max(120),
    imei: z.string().max(30).optional(),
    storage: z.string().max(30).optional(),
    condition: z.enum(CONDITIONS),
    functionalChecklist: tradeInFunctionalChecklistSchema.optional(),
    notes: z.string().max(2000).optional(),
    purchasePrice: z.number().min(0).max(99_999_999),
    paymentMethod: z.enum(PAYMENT_METHODS),
    signatureDataUrl: z
      .string()
      .startsWith("data:image/")
      .max(300_000)
      .optional(),
  })
  .strict();

export const updateTradeInSchema = z
  .object({
    sellerIdType: z.enum(SELLER_ID_TYPES).optional(),
    sellerIdNumber: z.string().min(4).max(30).optional(),
    deviceBrand: z.string().min(1).max(60).optional(),
    deviceModel: z.string().min(1).max(120).optional(),
    imei: z.string().max(30).nullable().optional(),
    storage: z.string().max(30).nullable().optional(),
    condition: z.enum(CONDITIONS).optional(),
    functionalChecklist: tradeInFunctionalChecklistSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    purchasePrice: z.number().min(0).max(99_999_999).optional(),
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    signatureDataUrl: z
      .string()
      .startsWith("data:image/")
      .max(300_000)
      .nullable()
      .optional(),
  })
  .strict();

export const tradeInStatusSchema = z.enum([
  "OFFERED",
  "PURCHASED",
  "CANCELLED",
  "SOLD",
]);

export type CreateTradeInInput = z.infer<typeof createTradeInSchema>;
export type UpdateTradeInInput = z.infer<typeof updateTradeInSchema>;
