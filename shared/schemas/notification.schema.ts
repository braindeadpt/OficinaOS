import { z } from "zod";
import { opaqueIdSchema } from "./id.schema";

export const listInAppQuerySchema = z.object({
  filter: z.enum(["all", "unread", "read"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const markReadParamSchema = z.object({
  id: opaqueIdSchema,
});

export const markReadAllSchema = z.object({});

export type ListInAppQueryInput = z.infer<typeof listInAppQuerySchema>;
export type MarkReadParamInput = z.infer<typeof markReadParamSchema>;
