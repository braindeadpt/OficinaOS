import { z } from "zod";

// "Procuro-peça" board (Pro module: market) — mirrors the cloud schema.
export const createPartRequestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  deviceBrand: z.string().trim().max(100).optional(),
  deviceModel: z.string().trim().max(100).optional(),
  partType: z.enum(["SCREEN", "BATTERY", "BOARD", "CAMERA", "PORT", "OTHER"]),
  condition: z.enum(["ANY", "NEW", "OEM", "USED"]).default("ANY"),
  maxPriceCents: z.number().int().min(0).max(10_000_000).optional(),
  notes: z.string().trim().max(2000).optional(),
  contact: z.string().trim().max(200).optional(),
});

export const partRequestReplySchema = z
  .object({
    note: z.string().trim().max(2000).optional(),
    priceCents: z.number().int().min(0).max(10_000_000).optional(),
    contact: z.string().trim().max(200).optional(),
  })
  .refine(
    (d) =>
      d.note !== undefined ||
      d.priceCents !== undefined ||
      d.contact !== undefined
  );

export const closePartRequestSchema = z.object({
  status: z.enum(["FOUND", "CLOSED"]),
});

export type CreatePartRequestInput = z.infer<typeof createPartRequestSchema>;
export type PartRequestReplyInput = z.infer<typeof partRequestReplySchema>;
