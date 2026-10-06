import {
  JobStatus,
  PartCategory,
  QC_CHECK_ITEMS,
  RepairCategory,
} from "@shared/constants";
import { imeiField } from "@shared/utils/imei";
import { z } from "zod";

const repairCategoryValues = Object.values(RepairCategory) as [
  string,
  ...string[],
];
const jobStatusValues = Object.values(JobStatus) as [string, ...string[]];

export const intakeRepairItemSchema = z.object({
  repairId: z.string().max(64).optional(),
  repairName: z.string().min(1).max(120),
  category: z.enum(repairCategoryValues),
  price: z.number().min(0).max(99_999_999.99),
});

export const createJobSchema = z.object({
  customerEmail: z
    .string()
    .max(254)
    .email({ error: "validations.email" })
    .optional()
    .or(z.literal("")),
  customerId: z.string().cuid().optional(),
  customerName: z.string().min(1, { error: "validations.enter_name" }).max(120),
  customerPhone: z
    .string()
    .min(1, { error: "validations.enter_phone" })
    .max(32),
  deviceBrand: z.string().min(1, { error: "validations.enter_brand" }).max(60),
  deviceBrandId: z.string().max(64).optional(),
  deviceModel: z.string().min(1, { error: "validations.enter_model" }).max(120),
  color: z.string().max(40).optional(),
  imei: imeiField,
  reportedProblem: z
    .string()
    .min(1, { error: "validations.describe_problem" })
    .max(2000),
  conditionNotes: z.string().max(2000).optional(),
  deviceUnlockCode: z.string().max(64).optional(),
  accessories: z.array(z.string().max(40)).max(12).optional(),
  intakeChecklist: z
    .record(z.string(), z.enum(["ok", "fail"]).nullable())
    .optional(),
  // Signature canvas PNG data URL — ~50-150KB typical, cap well above.
  intakeSignatureDataUrl: z
    .string()
    .startsWith("data:image/")
    .max(600_000)
    .optional(),
  // Optional — many shops only price a repair after diagnosis. Omitted/null
  // means "por orçamentar" (not yet quoted).
  estimatedCost: z
    .number()
    .min(0, { error: "validations.valid_cost" })
    .max(99_999_999.99, { error: "validations.valid_cost" })
    .nullable()
    .optional(),
  estimatedDate: z.coerce.date().optional(),
  depositAmount: z
    .number()
    .min(0, { error: "validations.valid_deposit" })
    .max(99_999_999.99)
    .optional(),
  technicianId: z.string().cuid({ error: "validations.invalid_id" }).optional(),
  isUrgent: z.boolean().optional(),
  isWarrantyReturn: z.boolean().optional(),
  warrantyForJobId: z.string().max(64).optional(),
  repairs: z.array(intakeRepairItemSchema).optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const updateJobSchema = z.object({
  reportedProblem: z.string().min(1).max(2000).optional(),
  conditionNotes: z.string().max(2000).optional(),
  estimatedCost: z.number().min(0).max(99_999_999.99).nullable().optional(),
  estimatedDate: z.coerce.date().nullable().optional(),
  depositAmount: z.number().min(0).max(99_999_999.99).nullable().optional(),
  technicianId: z.string().cuid().nullable().optional(),
  isUrgent: z.boolean().optional(),
  color: z.string().max(40).optional(),
  imei: imeiField,
  deviceUnlockCode: z.string().max(64).nullable().optional(),
  accessories: z.array(z.string().max(40)).max(12).optional(),
  intakeChecklist: z
    .record(z.string(), z.enum(["ok", "fail"]).nullable())
    .nullable()
    .optional(),
});

export const transitionStatusSchema = z
  .object({
    status: z.enum([
      JobStatus.INTAKE,
      JobStatus.WAITING_FOR_PARTS,
      JobStatus.IN_REPAIR,
      JobStatus.ON_HOLD,
      JobStatus.DONE,
      JobStatus.DELIVERED,
      JobStatus.RETURNED,
      JobStatus.CANCELLED,
    ]),
    reason: z.string().trim().max(500).optional(),
    actualLaborHours: z.number().positive().optional().nullable(),
    qcChecklist: z
      .record(z.string(), z.enum(["ok", "fail"]).nullable())
      .optional(),
  })
  .superRefine((val, ctx) => {
    const requiresReason =
      val.status === JobStatus.CANCELLED || val.status === JobStatus.ON_HOLD;
    if (requiresReason && (!val.reason || val.reason.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "validations.reason_required",
      });
    }

    if (
      val.status === JobStatus.DONE &&
      (val.actualLaborHours === undefined || val.actualLaborHours === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actualLaborHours"],
        message: "validations.labor_hours_required",
      });
    }

    if (val.status === JobStatus.DONE) {
      const missing = QC_CHECK_ITEMS.some(
        (item) =>
          val.qcChecklist?.[item] === undefined ||
          val.qcChecklist?.[item] === null
      );
      if (missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["qcChecklist"],
          message: "validations.qc_checklist_required",
        });
      }
    }
  });

export const addJobPartSchema = z.object({
  partId: z.string().optional(),
  partName: z.string().min(1).max(120),
  category: z.enum([
    PartCategory.SCREEN,
    PartCategory.BATTERY,
    PartCategory.CHARGING_PORT,
    PartCategory.CAMERA,
    PartCategory.SPEAKER,
    PartCategory.MICROPHONE,
    PartCategory.MOTHERBOARD,
    PartCategory.HOUSING,
    PartCategory.BUTTON,
    PartCategory.OTHER,
  ]),
  unitPrice: z.number().min(0).max(99_999_999.99),
  quantity: z.number().int().min(1).max(10_000).default(1),
  supplier: z.string().max(120).optional(),
});

export const addJobRepairSchema = z.object({
  repairId: z.string().optional(),
  repairName: z.string().min(1).max(120),
  category: z.enum(repairCategoryValues),
  price: z.number().min(0).max(99_999_999.99),
});

export const addJobNoteSchema = z.object({
  content: z.string().min(1).max(2000),
  isCustomerVisible: z.boolean().default(false),
});

export const addWaitingPartSchema = z.object({
  partName: z.string().min(1).max(120),
  supplier: z.string().max(120).optional(),
});

export const jobListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(jobStatusValues).optional(),
  technicianId: z.string().optional(),
  search: z.string().max(100).optional(),
  imei: imeiField,
});

export type UpdateJobInput = z.infer<typeof updateJobSchema>;
export type TransitionStatusInput = z.infer<typeof transitionStatusSchema>;
export type AddJobPartInput = z.infer<typeof addJobPartSchema>;
export type AddJobRepairInput = z.infer<typeof addJobRepairSchema>;
export type AddJobNoteInput = z.infer<typeof addJobNoteSchema>;
export type AddWaitingPartInput = z.infer<typeof addWaitingPartSchema>;
export type JobListQueryInput = z.infer<typeof jobListQuerySchema>;
export type IntakeRepairItem = z.infer<typeof intakeRepairItemSchema>;
