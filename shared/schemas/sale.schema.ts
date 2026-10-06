import { PaymentMethod } from "@shared/constants";
import { z } from "zod";

export const saleItemSchema = z.object({
  partId: z.string().optional(),
  name: z.string().min(1, { error: "validations.part_name_required" }).max(120),
  category: z.enum([
    "SCREEN",
    "BATTERY",
    "CHARGING_PORT",
    "CAMERA",
    "SPEAKER",
    "MICROPHONE",
    "MOTHERBOARD",
    "HOUSING",
    "BUTTON",
    "OTHER",
  ]),
  unitPrice: z
    .number()
    .min(0, { error: "validations.valid_cost" })
    .max(99_999_999.99, { error: "validations.valid_cost" }),
  quantity: z.number().int().min(1).max(10_000),
});

export const salePaymentSchema = z.object({
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
    .max(99_999_999.99),
  reference: z.string().trim().max(100).optional(),
});

export const createSaleSchema = z
  .object({
    customerId: z.string().optional(),
    items: z
      .array(saleItemSchema)
      .min(1, { error: "errors.sale_item_required" }),
    payments: z.array(salePaymentSchema).min(1, {
      error: "validations.valid_payment_amount",
    }),
  })
  .superRefine((val, ctx) => {
    const total = val.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const paid = val.payments.reduce((s, p) => s + p.amount, 0);
    // 0.01 tolerance for float rounding on the client.
    if (Math.abs(paid - total) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payments"],
        message: "errors.sale_payment_mismatch",
      });
    }
  });

export const listSalesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type ListSalesQueryInput = z.infer<typeof listSalesQuerySchema>;
export type SaleItemInput = z.infer<typeof saleItemSchema>;
export type SalePaymentInput = z.infer<typeof salePaymentSchema>;
