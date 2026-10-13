import { z } from "zod";

export const REFERRAL_STATUSES = [
  "SENT",
  "ACCEPTED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const createReferralSchema = z.object({
  toShopName: z.string().min(1).max(160),
  toShopContact: z.string().max(160).optional(),
  reason: z.string().max(1000).optional(),
});

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  notes: z.string().max(2000).optional(),
  toShopContact: z.string().max(160).optional(),
});
