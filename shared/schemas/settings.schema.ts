import { z } from "zod";

export const updateAiSettingsSchema = z
  .object({
    endpointUrl: z
      .string()
      .min(1, { error: "validations.endpoint_required" })
      .optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.endpointUrl !== undefined ||
      data.apiKey !== undefined ||
      data.model !== undefined ||
      data.temperature !== undefined ||
      data.enabled !== undefined,
    { message: "validations.at_least_one_field" }
  );

export const updateShopSettingsSchema = z
  .object({
    shopName: z
      .string()
      .min(1, { error: "validations.shop_name_required" })
      .optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    currency: z.string().optional(),
    receiptFooter: z.string().optional(),
    // Printing presets — applied by the server-rendered receipt/label HTML.
    receiptPaper: z.enum(["58mm", "80mm", "a4"]).optional(),
    receiptShowImei: z.boolean().optional(),
    receiptShowProblem: z.boolean().optional(),
    receiptShowSignature: z.boolean().optional(),
    receiptShowQr: z.boolean().optional(),
    receiptShowWarranty: z.boolean().optional(),
    labelSize: z.enum(["40x20", "57x32", "62x29"]).optional(),
    printerMode: z.enum(["browser", "escpos"]).optional(),
    printerHost: z.string().trim().max(253).nullable().optional(),
    printerPort: z.number().int().min(1).max(65_535).optional(),
    countryCode: z.string().optional(),
    timezone: z.string().min(1).optional(),
    // Meta mensal de faturação (€). 0/null limpa a meta.
    monthlyRevenueGoal: z.number().min(0).max(99_999_999).nullable().optional(),
    // Public review link (e.g. Google Business "write a review" URL) shown
    // on the tracking page and in the delivered notification. Empty string
    // clears it; anything else must be an http(s) URL.
    reviewUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(2048)
          .regex(/^https?:\/\//, { error: "validations.invalid_url" }),
      ])
      .optional(),
  })
  .refine(
    (data) =>
      data.shopName !== undefined ||
      data.address !== undefined ||
      data.phone !== undefined ||
      data.currency !== undefined ||
      data.receiptFooter !== undefined ||
      data.receiptPaper !== undefined ||
      data.receiptShowImei !== undefined ||
      data.receiptShowProblem !== undefined ||
      data.receiptShowSignature !== undefined ||
      data.receiptShowQr !== undefined ||
      data.receiptShowWarranty !== undefined ||
      data.labelSize !== undefined ||
      data.printerMode !== undefined ||
      data.printerHost !== undefined ||
      data.printerPort !== undefined ||
      data.countryCode !== undefined ||
      data.timezone !== undefined ||
      data.monthlyRevenueGoal !== undefined ||
      data.reviewUrl !== undefined,
    { message: "validations.at_least_one_field" }
  );

export const updateNotificationTemplateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["WHATSAPP", "IN_APP"]),
  body: z.string().min(1),
  isDefault: z.boolean().optional(),
});

export const updateWhatsAppSettingsSchema = z
  .object({
    apiToken: z.string().optional(),
    businessId: z.string().optional(),
    phoneNumberId: z.string().optional(),
    enabled: z.boolean().optional(),
    // Public base URL for customer-facing links in WhatsApp messages
    // (tracking deep links). Empty string clears it; anything else must
    // be an http(s) URL so customers can actually open it.
    trackingBaseUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(2048)
          .regex(/^https?:\/\//, { error: "validations.invalid_url" }),
      ])
      .optional(),
  })
  .refine(
    (data) =>
      data.apiToken !== undefined ||
      data.businessId !== undefined ||
      data.phoneNumberId !== undefined ||
      data.enabled !== undefined ||
      data.trackingBaseUrl !== undefined,
    { message: "validations.at_least_one_field" }
  );

export const pairCloudSchema = z.object({
  apiUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\//, { error: "validations.invalid_url" }),
  code: z
    .string()
    .trim()
    .min(4, { error: "validations.pairing_code_required" }),
});

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;
export type UpdateShopSettingsInput = z.infer<typeof updateShopSettingsSchema>;
export type UpdateNotificationTemplateInput = z.infer<
  typeof updateNotificationTemplateSchema
>;
export type UpdateWhatsAppSettingsInput = z.infer<
  typeof updateWhatsAppSettingsSchema
>;
