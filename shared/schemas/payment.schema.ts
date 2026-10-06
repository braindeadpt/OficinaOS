import { PaymentMethod } from "@shared/constants";
import { z } from "zod";

export const addPaymentSchema = z.object({
  method: z.enum([
    PaymentMethod.CASH,
    PaymentMethod.CARD,
    PaymentMethod.TRANSFER,
    PaymentMethod.MB_WAY,
    PaymentMethod.MULTIBANCO,
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

// One-click "paid on delivery": the method is chosen when marking the job;
// the payment itself is recorded automatically at delivery.
export const paymentOnDeliveryMethodSchema = z.enum([
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.TRANSFER,
  PaymentMethod.MB_WAY,
  PaymentMethod.MULTIBANCO,
  PaymentMethod.OTHER,
]);

export type PaymentOnDeliveryMethodType = z.infer<
  typeof paymentOnDeliveryMethodSchema
>;

export const paymentOnDeliverySchema = z.object({
  method: paymentOnDeliveryMethodSchema,
});
