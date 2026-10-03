import type { AuditAction, JobStatus } from "@generated/client";

export type DashboardRole = "OWNER" | "TECHNICIAN" | "FRONT_DESK";

export interface Scope {
  role: DashboardRole;
  shopTz: string;
  userId: string;
}

export interface FinancialTrendPoint {
  cost: number;
  date: string; // YYYY-MM-DD
  revenue: number;
}

export interface OverdueJobDTO {
  customerName: string;
  device: string;
  hoursLate: number;
  id: string;
  jobCode: string;
  repairSummary: string;
}

export interface WarrantyReturnDTO {
  createdAt: string;
  description: string;
  id: string;
  jobCode: string;
}

export interface OwnerDashboardDTO {
  activeJobs: number;
  avgProfitMargin: number;
  avgProfitMarginChange: number;
  avgProfitMarginPrev: number;
  completedToday: number;
  financialTrend: FinancialTrendPoint[];
  overdueJobs: OverdueJobDTO[];
  pickupReady: PickupReadyDTO[];
  pipeline: Record<JobStatus, number>;
  revenueChangePct: number;
  revenuePrevMonth: number;
  revenueThisMonth: number;
  warrantyReturns: WarrantyReturnDTO[];
}

export interface ScheduleItemDTO {
  customerName: string;
  device: string;
  estimatedDate: string | null;
  id: string;
  jobCode: string;
  repairSummary: string;
  status: JobStatus;
}

export interface ActivityItemDTO {
  action: AuditAction;
  createdAt: string;
  fromValue: string | null;
  id: string;
  jobCode: string | null;
  toValue: string | null;
}

export interface KanbanJobDTO {
  actualLaborHours: number | null;
  customerName: string;
  device: string;
  estimatedDate: string | null;
  holdReason: string | null;
  id: string;
  jobCode: string;
  reportedProblem: string;
  status: JobStatus;
}

export interface TechnicianDashboardDTO {
  avgRepairTimeHours: number;
  completedToday: number;
  myActiveJobs: number;
  myJobs: KanbanJobDTO[];
  partsAlerts: Array<{
    id: string;
    name: string;
    stockQuantity: number;
    reorderLevel: number;
  }>;
  pipeline: Record<JobStatus, number>;
  poolJobs: KanbanJobDTO[];
  priorityActions: {
    jobsNeedingStatusUpdate: number;
    overdueCount: number;
    partsWaitingCount: number;
  };
  recentActivity: ActivityItemDTO[];
  todaySchedule: ScheduleItemDTO[];
  waitingForParts: number;
}

export interface ActiveRepairDTO {
  customerName: string;
  deviceModel: string;
  estimatedDate: string | null;
  id: string;
  jobCode: string;
  status: JobStatus;
  technicianName: string | null;
  updatedAt: string;
}

export interface RecentIntakeDTO {
  createdAt: string;
  deviceModel: string;
  id: string;
  jobCode: string;
}

export interface PriorityAlertDTO {
  customerName: string | null;
  id: string;
  jobCode: string;
  kind: "OVERDUE" | "WARRANTY_RETURN" | "READY_FOR_PICKUP";
}

export interface PickupReadyDTO {
  customerName: string;
  customerPhone: string;
  deviceModel: string;
  id: string;
  jobCode: string;
  readyAt: string;
}

export interface FrontDeskDashboardDTO {
  activeRepairs: ActiveRepairDTO[];
  avgRepairTimeHours: number;
  pickupReady: PickupReadyDTO[];
  priorityAlerts: PriorityAlertDTO[];
  todayOverview: {
    totalToday: number;
    completedToday: number;
    recentIntakes: RecentIntakeDTO[];
  };
}
