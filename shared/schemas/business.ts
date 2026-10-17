import { z } from "zod";
import { WORKFLOW_TYPES } from "../constants/workflow";

const HTTP_URL = /^https?:/;
export const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
export const rate = z.string().regex(/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/);
const id = z.string().min(1).max(100).nullable().optional();
export const parties = { customerId: id, supplierId: id };
export const ticketFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000),
  area: z.string().trim().min(1).max(100),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  ...parties,
});
export const messageFields = z.object({
  channel: z.enum([
    "EMAIL",
    "FACEBOOK",
    "INSTAGRAM",
    "MESSENGER",
    "WHATSAPP",
    "SMS",
    "INTERNAL",
  ]),
  direction: z.enum(["INBOUND", "OUTBOUND", "NOTE"]),
  deliveryStatus: z.enum(["CAPTURED", "DRAFT"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(30_000),
  correspondent: z.string().max(300).optional(),
  ...parties,
});
export const messageLink = z.object({
  entityType: z
    .enum(WORKFLOW_TYPES)
    .refine((value) => value !== "GENERAL" && value !== "MESSAGE"),
  entityId: z.string().min(1).max(100),
});
export const agreementFields = z
  .object({
    kind: z.enum(["COMMISSION", "LICENSE", "RETAINER", "OTHER"]),
    title: z.string().trim().min(1).max(200),
    ...parties,
    amountGross: amount,
    vatRate: rate,
    commissionBasisNet: amount,
    commissionRate: rate,
    paidGross: amount,
    interval: z.enum(["ONCE", "MONTHLY", "YEARLY", "OTHER"]),
    status: z.enum(["ACTIVE", "SUSPENDED", "ENDED"]),
    reference: z.string().max(300).optional(),
    notes: z.string().max(20_000).optional(),
    startsAt: z.iso.datetime().nullable().optional(),
    renewsAt: z.iso.datetime().nullable().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
  })
  .refine(
    (value) =>
      !(value.startsAt && value.endsAt) || value.endsAt >= value.startsAt,
    { path: ["endsAt"], message: "Invalid date range" }
  );
export const orderFields = z.object({
  title: z.string().trim().min(1).max(200),
  ...parties,
  notes: z.string().max(8000).optional(),
  reference: z.string().max(100).optional(),
  kind: z.enum(["PRODUCT", "PART"]).default("PRODUCT"),
  purchaseUrl: z
    .union([z.literal(""), z.url().refine((value) => HTTP_URL.test(value))])
    .optional(),
  jobId: id,
  partId: id,
  costGross: amount.default("0"),
  quoteGross: amount.default("0"),
  costVatRate: rate.default("0"),
  saleVatRate: rate.default("0"),
  recoverInputVat: z.boolean().default(true),
});
