import { z } from "zod";
import { INTAKE_DOCUMENT_VERSION } from "../intake-document.js";

// Frozen document carried by a signature session — validated on create so a
// malformed snapshot can't produce a job that never verifies.
export const intakeDocumentSchema = z.object({
  accessories: z.array(z.string().max(40)).max(12),
  checklist: z.record(z.string(), z.enum(["ok", "fail"]).nullable()),
  color: z.string().max(40).nullable(),
  conditionNotes: z.string().max(2000).nullable(),
  customerEmail: z.string().max(254).nullable(),
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().min(1).max(32),
  deposit: z.number().min(0).nullable(),
  deviceBrand: z.string().min(1).max(60),
  deviceCategory: z.string().max(40).nullable(),
  deviceModel: z.string().min(1).max(120),
  deviceUnlockCode: z.string().max(64).nullable(),
  estimatedCost: z.number().min(0).nullable(),
  estimatedDelivery: z.string().max(40).nullable(),
  imei: z.string().max(64).nullable(),
  loaner: z.boolean(),
  loanerNote: z.string().max(200).nullable(),
  locale: z.string().max(10),
  problem: z.string().min(1).max(2000),
  repairs: z
    .array(z.object({ name: z.string().max(120), price: z.number().min(0) }))
    .max(50),
  termsText: z.string().min(1).max(4000),
  urgent: z.boolean(),
  v: z.literal(INTAKE_DOCUMENT_VERSION),
  warrantyReturn: z.boolean(),
});

export const createSignatureSessionSchema = z.object({
  document: intakeDocumentSchema,
});
