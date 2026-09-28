export type TimeRangePreset = "7d" | "30d" | "month" | "year";

export interface RevenueSummary {
  avgProfitMargin?: number;
  outstandingBalance: number;
  outstandingJobCount: number;
  revenueChangePercent?: number;
  totalDeposits: number;
  totalRevenue: number;
}

export interface RevenueBreakdownRow {
  completedAt: string;
  customerName: string;
  depositAmount: number;
  deviceName: string;
  estimatedCost: number;
  jobCode: string;
  margin?: number;
  partsCost: number;
  repairsTotal: number;
}

export interface RevenueReportDTO {
  breakdown: RevenueBreakdownRow[];
  summary: RevenueSummary;
}

export interface OperationsSummary {
  avgTurnaroundHours: number;
  jobsCompleted: number;
  jobsCompletedChangePercent?: number;
  jobsInProgress: number;
  warrantyReturnRate?: number;
}

export interface TopRepairRow {
  avgPrice: number;
  category: string;
  count: number;
  repairName: string;
  revenue: number;
}

export interface StatusBreakdownRow {
  avgDays: number;
  count: number;
  status: string;
}

export interface OperationsReportDTO {
  statusBreakdown: StatusBreakdownRow[];
  summary: OperationsSummary;
  topRepairs: TopRepairRow[];
}

export interface InsightsSummary {
  avgSpendPerVisit: number;
  newCustomers: number;
  repeatRate: number;
  returningCustomers: number;
  totalCustomers: number;
  totalJobs: number;
}

export interface TopCustomerRow {
  avgSpend: number;
  customerId: string;
  customerName: string;
  lastVisit: string;
  phone: string;
  totalJobs: number;
  totalRevenue: number;
}

export interface InsightsReportDTO {
  summary: InsightsSummary;
  topCustomers: TopCustomerRow[];
}

export interface ReturnsSummary {
  avgTimeToReturnChangePercent?: number;
  avgTimeToReturnDays: number;
  netWarrantyCost: number;
  netWarrantyCostChangePercent?: number;
  totalReturns: number;
  totalReturnsChangePercent?: number;
  warrantyReturnRate?: number;
  warrantyReturnRateChangePercent?: number;
}

export interface FaultCategoryRow {
  count: number;
  faultCategory: string;
}

export interface ReturnByRepairRow {
  count: number;
  faults: FaultCategoryRow[];
  repairName: string;
}

export interface ReturnByTechnicianRow {
  claimsCount: number;
  dominantFault?: string;
  jobsDelivered: number;
  returnRate: number;
  technicianId: string;
  technicianName: string;
}

export type TtrBucket = "0-7d" | "8-30d" | "31-60d" | "61-90d" | "90d+";

export interface TtrDistributionRow {
  bucket: TtrBucket;
  count: number;
}

export interface ReturnsReportDTO {
  byFaultCategory: FaultCategoryRow[];
  byRepairType: ReturnByRepairRow[];
  byTechnician: ReturnByTechnicianRow[];
  summary: ReturnsSummary;
  ttrDistribution: TtrDistributionRow[];
}

export interface PartConsumptionRow {
  avgUnitCost: number;
  category: string;
  partId: string | null;
  partName: string;
  quantity: number;
  /** Percentage change of quantity vs the previous equivalent period. */
  quantityChangePercent?: number;
  totalCost: number;
  usageCount: number;
}

export interface PartsConsumptionSummary {
  distinctParts: number;
  totalCost: number;
  totalQuantity: number;
  totalQuantityChangePercent?: number;
}

export interface PartsConsumptionReportDTO {
  /** True when POS accessory sales (sale_items) are aggregated too. */
  includePosSales: boolean;
  summary: PartsConsumptionSummary;
  topParts: PartConsumptionRow[];
}

export interface CashMethodRow {
  amount: number;
  count: number;
  method: string;
}

export interface CashUserRow {
  count: number;
  name: string;
  total: number;
}

export interface CashLargestPayment {
  amount: number;
  location: "JOB" | "POS";
  method: string;
  userName: string;
}

export interface CashReportSummary {
  /** Payments made in physical cash (method CASH). */
  cashTotal: number;
  paymentCount: number;
  totalCollected: number;
  /** Card + transfer + other non-cash methods combined. */
  transferTotal: number;
  userCount: number;
}

export interface CashReportDTO {
  byMethod: CashMethodRow[];
  byUser: CashUserRow[];
  /** ISO timestamp of the shop-local day start used to bucket the report. */
  date: string;
  largestPayment: CashLargestPayment | null;
  summary: CashReportSummary;
}
