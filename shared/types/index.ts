import type { Prisma } from "@generated/client";

export type User = Prisma.UserGetPayload<Record<string, never>>;
export type SafeUser = Omit<User, "password">;
export type Customer = Prisma.CustomerGetPayload<Record<string, never>>;
export type Device = Prisma.DeviceGetPayload<Record<string, never>>;
export type Brand = Prisma.BrandGetPayload<Record<string, never>>;
export type Job = Prisma.JobGetPayload<{
  include: {
    customer: true;
    device: { include: { brand: true } };
    technician: { select: { id: true; name: true; username: true } };
    photos: true;
    notes: {
      include: {
        createdBy: { select: { id: true; name: true; username: true } };
      };
    };
    partsWaiting: true;
    partsUsed: true;
    payments: { select: { amount: true } };
    repairs: true;
  };
}> & {
  // Server-computed fields (see job.service getById)
  balanceDue?: number;
  finalCost?: number;
  paidTotal?: number;
  margin?: number;
};
export type JobPhoto = Prisma.JobPhotoGetPayload<Record<string, never>>;
export type JobNote = Prisma.JobNoteGetPayload<{
  include: { createdBy: { select: { id: true; name: true; username: true } } };
}>;
export type JobPart = Prisma.JobPartGetPayload<Record<string, never>>;
export type JobRepair = Prisma.JobRepairGetPayload<Record<string, never>>;
export type Payment = Prisma.PaymentGetPayload<{
  include: { createdBy: { select: { id: true; name: true; username: true } } };
}>;
export type PartsCatalog = Prisma.PartsCatalogGetPayload<Record<string, never>>;
export type RepairCatalog = Prisma.RepairCatalogGetPayload<
  Record<string, never>
>;
export type AuditLog = Prisma.AuditLogGetPayload<Record<string, never>>;
export type NotificationTemplate = Prisma.NotificationTemplateGetPayload<
  Record<string, never>
>;
export type ShopSettings = Prisma.ShopSettingsGetPayload<Record<string, never>>;
export type AiSettings = Prisma.AiSettingsGetPayload<Record<string, never>>;
export type Session = Prisma.SessionGetPayload<Record<string, never>>;
export type Account = Prisma.AccountGetPayload<Record<string, never>>;
export type Verification = Prisma.VerificationGetPayload<Record<string, never>>;
export type JobPartsWaiting = Prisma.JobPartsWaitingGetPayload<
  Record<string, never>
>;
export type JobCounter = Prisma.JobCounterGetPayload<Record<string, never>>;
export type Sale = Prisma.SaleGetPayload<{
  include: {
    items: true;
    payments: true;
    customer: { select: { id: true; name: true; phone: true } };
    createdBy: { select: { id: true; name: true } };
  };
}>;
export type NotificationOutbox = Prisma.NotificationOutboxGetPayload<
  Record<string, never>
>;
export type AiConversation = Prisma.AiConversationGetPayload<
  Record<string, never>
>;
export type AiMessage = Prisma.AiMessageGetPayload<Record<string, never>>;
export type AiAgentDefinition = Prisma.AiAgentDefinitionGetPayload<
  Record<string, never>
>;
export type AiMemory = Prisma.AiMemoryGetPayload<Record<string, never>>;
export type AiInstruction = Prisma.AiInstructionGetPayload<
  Record<string, never>
>;
// AiChatHistory model removed from schema — type no longer available
export type InAppNotification = Prisma.InAppNotificationGetPayload<
  Record<string, never>
>;
