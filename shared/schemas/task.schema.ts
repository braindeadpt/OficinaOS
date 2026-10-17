import { JobStatus } from "@shared/constants/job-statuses";
import { WORKFLOW_TYPES } from "@shared/constants/workflow";
import { z } from "zod";

const taskFields = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(4000).optional(),
  assigneeId: z.string().min(1).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  nextTitle: z.string().trim().min(1).max(200).optional(),
  nextDelayHours: z.number().int().min(0).max(8760).default(0),
});

export const createTaskSchema = taskFields
  .extend({
    entityType: z.enum(WORKFLOW_TYPES).default("GENERAL"),
    entityId: z.string().min(1).optional(),
    jobCode: z.string().trim().min(1).max(80).optional(),
    scheduledAt: z.iso.datetime().optional(),
    dueAt: z.iso.datetime().optional(),
  })
  .refine(
    (value) =>
      !(value.dueAt && value.scheduledAt) || value.dueAt >= value.scheduledAt,
    {
      path: ["dueAt"],
      message: "validations.invalid_date",
    }
  );

export const createTaskRuleSchema = taskFields
  .extend({
    triggerStatus: z.enum(Object.values(JobStatus)).optional(),
    workflowStateId: z.string().min(1).optional(),
    entityType: z.enum(WORKFLOW_TYPES).optional(),
    delayHours: z.number().int().min(0).max(8760).default(0),
  })
  .refine(
    (input) => Boolean(input.triggerStatus) !== Boolean(input.workflowStateId),
    { message: "validations.invalid_value" }
  );

export const taskListSchema = z.object({
  entityType: z.enum(WORKFLOW_TYPES).optional(),
  entityId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  completed: z.enum(["true", "false"]).default("false"),
  cursor: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateTaskRuleInput = z.infer<typeof createTaskRuleSchema>;

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
    scheduledAt: z.iso.datetime().optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    nextTitle: z.string().trim().min(1).max(200).nullable().optional(),
    nextDelayHours: z.number().int().min(0).max(8760).optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
