import { z } from "zod";

export const closeCashSessionSchema = z.object({
  /** Physical cash counted in the drawer. */
  countedCash: z
    .number()
    .min(0, "validations.min_value")
    .max(9_999_999, "validations.max_value"),
  /** Optional recount of non-cash slips (card terminal receipts etc.). */
  countedNonCash: z
    .number()
    .min(0, "validations.min_value")
    .max(9_999_999, "validations.max_value")
    .optional(),
  /** Cashier-declared grand total; may be negative for a signed paper trail. */
  countedTotalCollected: z
    .number()
    .min(-9_999_999, "validations.min_value")
    .max(9_999_999, "validations.max_value")
    .optional(),
  note: z.string().max(2000, "validations.max_length").optional(),
  /** Signature image as a PNG data URL, drawn on the close dialog. */
  signatureDataUrl: z
    .string()
    .startsWith("data:image/png;base64,", "validations.invalid_signature")
    .max(1_000_000, "validations.max_length")
    .optional(),
});

export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;
