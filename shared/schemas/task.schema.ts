import { JobStatus } from "@shared/constants/job-statuses";
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

export const createTaskRuleSchema = taskFields.extend({
  triggerStatus: z.enum(Object.values(JobStatus)),
  delayHours: z.number().int().min(0).max(8760).default(0),
});

export const taskListSchema = z.object({
  jobId: z.string().min(1).optional(),
  completed: z.enum(["true", "false"]).default("false"),
  cursor: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type CreateTaskRuleInput = z.infer<typeof createTaskRuleSchema>;
