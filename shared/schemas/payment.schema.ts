import { PaymentMethod } from "@shared/constants";
import { z } from "zod";

export const addPaymentSchema = z.object({
  method: z.enum([
    PaymentMethod.CASH,
    PaymentMethod.CARD,
    PaymentMethod.TRANSFER,
    PaymentMethod.OTHER,
  ]),
  amount: z
    .number()
    .min(0.01, { error: "validations.valid_payment_amount" })
    .max(99_999_999.99, { error: "validations.valid_payment_amount" }),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional(),
});

export type AddPaymentInput = z.infer<typeof addPaymentSchema>;
