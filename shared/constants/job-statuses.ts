export const JobStatus = {
  INTAKE: "INTAKE",
  WAITING_FOR_PARTS: "WAITING_FOR_PARTS",
  IN_REPAIR: "IN_REPAIR",
  ON_HOLD: "ON_HOLD",
  DONE: "DONE",
  DELIVERED: "DELIVERED",
  RETURNED: "RETURNED",
  CANCELLED: "CANCELLED",
} as const;

export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];

export const ACTIVE_STATUSES: JobStatusType[] = [
  "INTAKE",
  "WAITING_FOR_PARTS",
  "IN_REPAIR",
  "ON_HOLD",
  "DONE",
];

export const INACTIVE_STATUSES: JobStatusType[] = [
  "DELIVERED",
  "RETURNED",
  "CANCELLED",
];

export const COMPLETED_STATUSES: JobStatusType[] = ["DONE", "DELIVERED"];

export const JOB_STATUS_FLOW: Record<JobStatusType, JobStatusType[]> = {
  INTAKE: ["WAITING_FOR_PARTS", "IN_REPAIR", "ON_HOLD", "CANCELLED"],
  WAITING_FOR_PARTS: ["IN_REPAIR", "ON_HOLD", "CANCELLED"],
  IN_REPAIR: ["WAITING_FOR_PARTS", "ON_HOLD", "DONE", "CANCELLED"],
  ON_HOLD: ["IN_REPAIR", "CANCELLED"],
  DONE: ["DELIVERED", "RETURNED"],
  DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

export const QC_CHECK_ITEMS = [
  "powersOn",
  "screen",
  "touch",
  "cameras",
  "audio",
  "charging",
] as const;
