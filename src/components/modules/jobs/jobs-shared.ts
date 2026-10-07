import type { JobStatusType } from "@shared/constants";
import type { Job } from "@shared/types";

export interface JobRow {
  customer: string;
  customerTier?: string;
  device: string;
  deviceIcon?: string;
  deviceSpec?: string;
  id: string;
  imei?: string;
  isUrgent?: boolean;
  rawJob?: Job;
  status: JobStatusType;
  technician?: string;
}

const STATUS_GROUP_ACTIVE: JobStatusType[] = [
  "INTAKE" as const,
  "IN_REPAIR" as const,
  "ON_HOLD" as const,
];

const STATUS_GROUP_WAITING: JobStatusType[] = [
  "WAITING_FOR_PARTS" as const,
  "DONE" as const,
];

const STATUS_GROUP_CLOSED: JobStatusType[] = [
  "DELIVERED" as const,
  "RETURNED" as const,
  "CANCELLED" as const,
];

export const STATUS_GROUPS = [
  {
    key: "active",
    labelKey: "status_group_active",
    statuses: STATUS_GROUP_ACTIVE,
  },
  {
    key: "waiting",
    labelKey: "status_group_waiting",
    statuses: STATUS_GROUP_WAITING,
  },
  {
    key: "closed",
    labelKey: "status_group_closed",
    statuses: STATUS_GROUP_CLOSED,
  },
] as const;

export type StatusGroupKey = (typeof STATUS_GROUPS)[number]["key"];

function inferDeviceType(brand: string): string {
  const lower = brand.toLowerCase();
  if (lower.includes("ipad")) {
    return "tablet";
  }
  if (lower.includes("mac") || lower.includes("laptop")) {
    return "laptop";
  }
  if (lower.includes("watch")) {
    return "watch";
  }
  return "phone";
}

export function jobToRow(job: Job): JobRow {
  const brandName = job.device?.brand?.name ?? "";
  // The model's stored category wins; rows without one (legacy) fall back
  // to the brand-name guess.
  const deviceType =
    job.device?.category ?? (job.device ? inferDeviceType(brandName) : "phone");

  return {
    id: job.jobCode ?? job.id,
    customer: job.customer?.name ?? "",
    device: job.device ? `${brandName} ${job.device.model}` : "",
    deviceIcon: deviceType,
    deviceSpec: job.device?.model ?? "",
    imei: job.imei ?? undefined,
    isUrgent: job.isUrgent ?? undefined,
    rawJob: job,
    status: job.status,
    technician: job.technician?.name,
  };
}
