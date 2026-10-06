import type { JobStatusType } from "@shared/constants";
import { JobStatus } from "@shared/constants";
import { statusDotClass } from "@/lib/status-colors";

export interface PipelineItem {
  color: string;
  descriptionKey: string;
  status: JobStatusType;
}

export const PIPELINE_ITEMS: PipelineItem[] = [
  {
    status: JobStatus.INTAKE,
    color: statusDotClass(JobStatus.INTAKE),
    descriptionKey: "pipeline_intake_desc",
  },
  {
    status: JobStatus.WAITING_FOR_PARTS,
    color: statusDotClass(JobStatus.WAITING_FOR_PARTS),
    descriptionKey: "pipeline_waiting_desc",
  },
  {
    status: JobStatus.IN_REPAIR,
    color: statusDotClass(JobStatus.IN_REPAIR),
    descriptionKey: "pipeline_repair_desc",
  },
  {
    status: JobStatus.ON_HOLD,
    color: statusDotClass(JobStatus.ON_HOLD),
    descriptionKey: "pipeline_hold_desc",
  },
  {
    status: JobStatus.DONE,
    color: statusDotClass(JobStatus.DONE),
    descriptionKey: "pipeline_done_desc",
  },
];

// On Hold used to be re-tinted red here so it stood out; the status tokens
// already give it its own (violet) family, so both lists are now the same.
export const PIPELINE_ITEMS_ACCENT: PipelineItem[] = PIPELINE_ITEMS;
