import type { FaultCategory } from "@generated/enums";

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

export interface OrdersReportRow {
  completedAt?: string;
  createdAt: string;
  customerName: string;
  deviceName: string;
  jobCode: string;
  margin?: number;
  partsCost: number;
  repairsTotal: number;
  status: string;
  totalValue: number;
}

export interface OrdersReportDTO {
  rows: OrdersReportRow[];
  summary: {
    avgMargin?: number;
    avgOrderValue: number;
    totalOrders: number;
    totalValue: number;
  };
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
  faultCategory: FaultCategory;
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

export interface RestockForecastRow {
  /** Average units consumed per day over the analysis window (0 = no usage). */
  avgDailyUsage: number;
  /** Days until stock hits zero at the average rate; null without usage. */
  daysLeft: number | null;
  partId: string;
  partName: string;
  reorderLevel: number;
  stockQuantity: number;
  /** Units to buy to reach the restock target (always > 0 on returned rows). */
  suggestedQuantity: number;
  supplier: string | null;
}

export interface RestockForecastDTO {
  rows: RestockForecastRow[];
  summary: { partsAtRisk: number; totalSuggestedQuantity: number };
  /** Analysis window in days (consumption sampled over this period). */
  windowDays: number;
}

export interface CashSessionUser {
  id: string;
  name: string;
}

export interface CashSessionCounted {
  /** Physical cash counted in the drawer at close time. */
  cash: number | null;
  /** Optional recount of non-cash slips (card terminal receipts etc.). */
  nonCash: number | null;
  /** Cashier-declared grand total (may be signed for the paper trail). */
  totalCollected: number | null;
}

export interface CashSessionDivergence {
  /** countedCash − systemCash at close time; negative = cash missing. */
  cash: number | null;
}

export interface CashSessionDTO {
  closedAt: string | null;
  closedBy: CashSessionUser | null;
  counted: CashSessionCounted;
  /** ISO timestamp of the shop-local day start the session covers. */
  day: string;
  divergence: CashSessionDivergence;
  id: string;
  note: string | null;
  openedAt: string;
  openedBy: CashSessionUser;
  reopenCount: number;
  /** System figures: live while OPEN, frozen snapshot once CLOSED. */
  report: CashReportDTO;
  /** Signature image as a data URL (PNG), drawn at close time. */
  signatureDataUrl: string | null;
  status: "OPEN" | "CLOSED";
  /** IANA timezone the session day was bucketed in. */
  timezone: string;
}
