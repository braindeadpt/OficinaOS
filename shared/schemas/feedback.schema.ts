import { z } from "zod";

export const reportProblemSchema = z.object({
  description: z.string().trim().min(10).max(4000),
  contact: z.string().trim().max(200).optional(),
  context: z
    .object({
      url: z.string().max(500).optional(),
      userAgent: z.string().max(300).optional(),
      locale: z.string().max(20).optional(),
      errors: z.array(z.string().max(500)).max(10).optional(),
    })
    .optional(),
});

export type ReportProblemInput = z.infer<typeof reportProblemSchema>;
