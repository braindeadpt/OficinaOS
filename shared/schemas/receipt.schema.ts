import { z } from "zod";
import { opaqueIdSchema } from "./id.schema";

export const jobIdParamSchema = z.object({
  id: opaqueIdSchema,
});

export type JobIdParamInput = z.infer<typeof jobIdParamSchema>;
