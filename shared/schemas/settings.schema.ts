import { z } from "zod";

const ORIGIN_LIST_SPLIT = /[\s,]+/;

// Every non-empty token must be a valid http(s) URL — the value feeds CSP
// frame-ancestors on /embed/*, so garbage must be rejected at the API edge.
function isOriginList(value: string): boolean {
  return value
    .split(ORIGIN_LIST_SPLIT)
    .filter(Boolean)
    .every((token) => {
      try {
        const url = new URL(token);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    });
}

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
      .max(120)
      .optional(),
    // Modo da instância — a rota já exige settings.edit (OWNER-only),
    // por isso não fica ao alcance de técnicos/front-desk.
    shopMode: z.enum(["repair_shop", "ponto_only"]).optional(),
    address: z.string().max(255).optional(),
    phone: z.string().max(32).optional(),
    currency: z.string().max(8).optional(),
    receiptFooter: z.string().max(2000).optional(),
    // Claúsulas da ficha de entrada — null/vazio = predefinição da app.
    intakeTerms: z.string().max(4000).optional(),
    // Caixa de entrada (Pro "ai-inbox") — dias de retenção das conversas.
    inboxRetentionDays: z.number().int().min(30).max(3650).optional(),
    // Bot com IA (Pro): flag de rollout + ficha "O que o bot pode dizer".
    botAiEnabled: z.boolean().optional(),
    botInfoText: z.string().max(4000).nullable().optional(),
    botAvgRepairDaysAfterPart: z.number().int().min(0).max(60).optional(),
    botClosedFallbackText: z.string().max(500).nullable().optional(),
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
    printerHighContrast: z.boolean().optional(),
    countryCode: z.string().max(8).optional(),
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
    // Origins allowed to iframe the /embed/* widget (frame-ancestors). One
    // per line or comma-separated; empty/null = any site may embed it.
    embedAllowedOrigins: z
      .string()
      .max(4000)
      .refine(isOriginList, { error: "validations.invalid_url" })
      .nullable()
      .optional(),
    // Livro de ponto (Pro "ponto") — geolocalização da loja (par
    // lat+lng), raio do registo e opções de externos/lembretes.
    pontoGeoLat: z.number().min(-90).max(90).nullable().optional(),
    pontoGeoLng: z.number().min(-180).max(180).nullable().optional(),
    pontoRadiusM: z.number().int().min(10).max(2000).optional(),
    pontoExternalAutoApprove: z.boolean().optional(),
    pontoExternalPhotoRequired: z.boolean().optional(),
    // Hora do lembrete de saída (HH:MM) — null/vazio desliga.
    pontoExitReminderTime: z
      .union([
        z.literal(""),
        z.null(),
        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      ])
      .optional(),
    pontoPauseReminderMinutes: z.number().int().min(5).max(120).optional(),
    pontoInfoText: z.string().max(4000).nullable().optional(),
    // Números de WhatsApp/SMS que o QR do livro de ponto divulga —
    // E.164-ish, opcional +.
    pontoWaNumber: z
      .union([
        z.literal(""),
        z.null(),
        z
          .string()
          .trim()
          .regex(/^\+?\d{8,15}$/),
      ])
      .optional(),
    pontoSmsNumber: z
      .union([
        z.literal(""),
        z.null(),
        z
          .string()
          .trim()
          .regex(/^\+?\d{8,15}$/),
      ])
      .optional(),
  })
  .refine(
    // A geolocalização é um par — meia-configuração não serve para o
    // raio. Quem toca num dos campos tem de enviar os dois (null+null
    // limpa; número+número define; misto é rejeitado).
    (data) =>
      (data.pontoGeoLat === undefined && data.pontoGeoLng === undefined) ||
      ((data.pontoGeoLat === undefined) === (data.pontoGeoLng === undefined) &&
        (data.pontoGeoLat == null) === (data.pontoGeoLng == null)),
    { error: "validations.incomplete_point" }
  )
  .refine(
    (data) =>
      data.shopName !== undefined ||
      data.shopMode !== undefined ||
      data.address !== undefined ||
      data.phone !== undefined ||
      data.currency !== undefined ||
      data.receiptFooter !== undefined ||
      data.intakeTerms !== undefined ||
      data.inboxRetentionDays !== undefined ||
      data.botAiEnabled !== undefined ||
      data.botInfoText !== undefined ||
      data.botAvgRepairDaysAfterPart !== undefined ||
      data.botClosedFallbackText !== undefined ||
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
      data.printerHighContrast !== undefined ||
      data.countryCode !== undefined ||
      data.timezone !== undefined ||
      data.monthlyRevenueGoal !== undefined ||
      data.reviewUrl !== undefined ||
      data.embedAllowedOrigins !== undefined ||
      data.pontoGeoLat !== undefined ||
      data.pontoGeoLng !== undefined ||
      data.pontoRadiusM !== undefined ||
      data.pontoExternalAutoApprove !== undefined ||
      data.pontoExternalPhotoRequired !== undefined ||
      data.pontoExitReminderTime !== undefined ||
      data.pontoPauseReminderMinutes !== undefined ||
      data.pontoInfoText !== undefined ||
      data.pontoWaNumber !== undefined ||
      data.pontoSmsNumber !== undefined,
    { message: "validations.at_least_one_field" }
  );

export const updateNotificationTemplateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["WHATSAPP", "IN_APP", "SMS"]),
  body: z.string().min(1),
  isDefault: z.boolean().optional(),
});

export const updateWhatsAppSettingsSchema = z
  .object({
    apiToken: z.string().optional(),
    // Consentimento explícito para guardar o token Meta cifrado na
    // OficinaOS Cloud e enviar pelo relay — grava whatsappCloudConsentAt
    // uma vez no servidor. Sem ele não há upload de credenciais.
    cloudConsent: z.boolean().optional(),
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
    // Remarketing automático (módulo Pro "remarketing") — Meta template
    // message a clientes inativos. O nome do template tem de existir e
    // estar aprovado na conta Meta Business da loja.
    remarketingEnabled: z.boolean().optional(),
    remarketingDays: z.number().int().min(30).max(365).optional(),
    remarketingCooldownDays: z.number().int().min(30).max(365).optional(),
    remarketingTemplate: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(100)
          .regex(/^[a-z0-9_]+$/, {
            error: "validations.invalid_template_name",
          }),
      ])
      .optional(),
    // Pickup reminder (job_done_reminder): nome do template Meta aprovado
    // usado quando o lembrete sai por WhatsApp fora da janela de 24h
    // (transportes meta/cloud). Vazio = sem envio por template.
    pickupReminderTemplate: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(100)
          .regex(/^[a-z0-9_]+$/, {
            error: "validations.invalid_template_name",
          }),
      ])
      .optional(),
    // Transporte WhatsApp: "meta" = Cloud API oficial (default);
    // "evolution" = Evolution API self-hosted na LAN (não-oficial,
    // risco de ban — exige disclaimerAccepted e módulo whatsapp-bot,
    // verificado na route).
    transport: z.enum(["meta", "evolution"]).optional(),
    evolutionUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(2048)
          .regex(/^https?:\/\//, { error: "validations.invalid_url" }),
      ])
      .optional(),
    evolutionInstance: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(64)
          .regex(/^[a-z0-9-]+$/i, { error: "validations.invalid_instance" }),
      ])
      .optional(),
    evolutionApiKey: z.string().max(256).optional(),
    // Checkbox obrigatória antes de ativar o modo local — grava
    // whatsappLocalDisclaimerAt no servidor.
    disclaimerAccepted: z.boolean().optional(),
    // Termo do BOT no transporte Evolution (§5.7) — separado do
    // disclaimer do transporte: respostas automáticas aumentam o risco
    // de ban. Re-aceitar reativa o bot após uma suspensão por sessão.
    botDisclaimerAccepted: z.boolean().optional(),
    // Teto de respostas automáticas por dia na instância (anti-ban).
    botDailyCap: z.number().int().min(10).max(2000).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "validations.at_least_one_field",
  });

// Faturação (módulo Pro "invoicing") — a conta InvoiceXpress e a API key
// pertencem à loja; a key é encriptada antes de gravar e nunca volta à UI.
export const updateInvoicingSettingsSchema = z
  .object({
    account: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(64)
          .regex(/^[a-z0-9-]+$/i, { error: "validations.invalid_account" }),
      ])
      .optional(),
    apiKey: z.string().max(256).optional(),
    enabled: z.boolean().optional(),
    taxName: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(32)
          .regex(/^[a-z0-9]+$/i, { error: "validations.invalid_tax_name" }),
      ])
      .optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "validations.at_least_one_field",
  });

// SMS via gateway local (módulo Pro "sms") — SMS Gateway for Android em
// modo Local Server: a app envia HTTP Basic direto ao telemóvel na LAN.
// A password é write-only (encriptada, nunca volta à UI).
export const updateSmsSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    gatewayUrl: z
      .union([
        z.literal(""),
        z
          .string()
          .trim()
          .max(2048)
          .regex(/^https?:\/\//, { error: "validations.invalid_url" }),
      ])
      .optional(),
    gatewayUser: z.string().trim().max(64).optional(),
    gatewayPassword: z.string().max(256).optional(),
    // Rotação explícita do token do webhook inbound — gravações de
    // rotina preservam-no para não partir a URL no Android.
    rotateWebhookToken: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "validations.at_least_one_field",
  });

export const pairCloudSchema = z.object({
  apiUrl: z
    .string()
    .trim()
    .max(2048)
    .regex(/^https?:\/\//, { error: "validations.invalid_url" })
    // The pairing code + shop token travel over this URL — https only,
    // except loopback (local cloud dev instance).
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === "https:" ||
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
          );
        } catch {
          return false;
        }
      },
      { error: "validations.invalid_url" }
    ),
  code: z
    .string()
    .trim()
    .min(4, { error: "validations.pairing_code_required" }),
});

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;
export type UpdateInvoicingSettingsInput = z.infer<
  typeof updateInvoicingSettingsSchema
>;
export type UpdateShopSettingsInput = z.infer<typeof updateShopSettingsSchema>;
export type UpdateSmsSettingsInput = z.infer<typeof updateSmsSettingsSchema>;
export type UpdateNotificationTemplateInput = z.infer<
  typeof updateNotificationTemplateSchema
>;
export type UpdateWhatsAppSettingsInput = z.infer<
  typeof updateWhatsAppSettingsSchema
>;
