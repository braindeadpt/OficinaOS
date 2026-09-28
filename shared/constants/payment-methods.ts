export const PaymentMethod = {
  CASH: "CASH",
  CARD: "CARD",
  TRANSFER: "TRANSFER",
  OTHER: "OTHER",
} as const;

export type PaymentMethodType =
  (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** Methods that can appear on receipts as-is (label key: payment_method.<value>). */
export const PAYMENT_METHODS: PaymentMethodType[] = Object.values(
  PaymentMethod
) as PaymentMethodType[];
