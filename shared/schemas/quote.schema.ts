import { z } from "zod";

export const sendQuoteSchema = z.object({
  amount: z.number().min(0).max(99_999_999.99).optional(),
  note: z.string().trim().max(2000).optional(),
});

export const quoteRespondSchema = z.object({
  code: z.string().min(1).max(50),
  phone4: z.string().regex(/^\d{4}$/),
  quoteId: z.string().min(1).max(64),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
});

export type SendQuoteInput = z.infer<typeof sendQuoteSchema>;
export type QuoteRespondInput = z.infer<typeof quoteRespondSchema>;
