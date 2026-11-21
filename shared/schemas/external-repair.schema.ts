import { z } from "zod";

export const externalRepairCreateSchema = z.object({
  supplierId: z.string().min(1),
  kind: z.enum(["WARRANTY", "REPAIRER"]).default("REPAIRER"),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  expectedReturnAt: z.coerce.date().optional(),
});

export const externalRepairReturnSchema = z.object({
  costFinal: z.coerce.number().min(0).max(1_000_000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type ExternalRepairCreateInput = z.infer<
  typeof externalRepairCreateSchema
>;
export type ExternalRepairReturnInput = z.infer<
  typeof externalRepairReturnSchema
>;
