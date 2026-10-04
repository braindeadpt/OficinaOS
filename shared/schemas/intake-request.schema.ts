import { z } from "zod";

// Public pre-check form. `company` is a honeypot — real browsers hide it,
// so a filled value means a bot; the route fakes success without storing.
export const preCheckSubmitSchema = z.object({
  company: z.string().max(200).optional(),
  customerEmail: z
    .string()
    .email({ error: "validations.email" })
    .optional()
    .or(z.literal("")),
  customerName: z
    .string()
    .trim()
    .min(2, { error: "validations.enter_name" })
    .max(100),
  customerPhone: z
    .string()
    .trim()
    .min(6, { error: "validations.enter_phone" })
    .max(30),
  deviceLabel: z.string().trim().min(2).max(100),
  problem: z.string().trim().min(10).max(2000),
  whatsappOptIn: z.boolean().optional(),
  // Optional appointment request — ISO 8601, must be in the future and
  // within the next 30 days. The shop confirms availability by phone.
  scheduledFor: z
    .string()
    .datetime({ offset: true })
    .refine((v) => {
      const ts = Date.parse(v);
      const now = Date.now();
      return ts > now - 60_000 && ts < now + 30 * 86_400_000;
    })
    .optional(),
});

export const convertIntakeRequestSchema = z.object({
  jobId: z.string().cuid({ error: "validations.invalid_id" }),
});

export type ConvertIntakeRequestInput = z.infer<
  typeof convertIntakeRequestSchema
>;
export type PreCheckSubmitInput = z.infer<typeof preCheckSubmitSchema>;
