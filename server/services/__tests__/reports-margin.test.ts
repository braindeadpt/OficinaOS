import type { PrismaClient } from "@generated/client";
import type { Scope } from "@shared/types/dashboard";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateJobDeposits,
  aggregateJobRevenue,
  aggregateOutstandingJobs,
  findOrdersForReport,
  findRevenueBreakdown,
  queryRawProfitMargin,
} from "../../repositories/report.repository.js";
import { ordersReport, revenueReport } from "../reports.service.js";

vi.mock("../../repositories/report.repository.js", () => ({
  aggregateJobDeposits: vi.fn(),
  aggregateJobRevenue: vi.fn(),
  aggregateOutstandingJobs: vi.fn(),
  countJobs: vi.fn(),
  countJobsSimple: vi.fn(),
  countReturnClaims: vi.fn(),
  findAuditLogsForStatus: vi.fn(),
  findCustomersByIds: vi.fn(),
  findOrdersForReport: vi.fn(),
  findRevenueBreakdown: vi.fn(),
  findTurnaroundJobs: vi.fn(),
  groupJobRepairs: vi.fn(),
  groupJobsByCustomer: vi.fn(),
  groupJobsByCustomerWithMinDate: vi.fn(),
  groupJobsByStatus: vi.fn(),
  groupTopCustomersByRevenue: vi.fn(),
  queryRawProfitMargin: vi.fn(),
}));

const ownerScope: Scope = { role: "OWNER", shopTz: "UTC", userId: "owner-1" };
const range = {
  start: new Date("2026-01-01T00:00:00Z"),
  end: new Date("2026-02-01T00:00:00Z"),
};
const prisma = {} as PrismaClient;

// One billed job: €100 repair + €20 parts (billed at cost) − €95 paid to an
// external repairer = €5 profit on €120 billed → 4.17% margin. The report
// row must use the same revenue base as the summary or it shows −15%.
const JOB_ROW = {
  auditLogs: [{ createdAt: new Date("2026-01-12T10:00:00Z") }],
  createdAt: new Date("2026-01-10T10:00:00Z"),
  customer: { name: "Cliente X" },
  depositAmount: null,
  device: { brand: { name: "Apple" }, model: "iPhone 13" },
  estimatedCost: 100,
  externalRepairs: [{ costFinal: 95 }],
  id: "job-1",
  jobCode: "REP-2026-000001",
  partsUsed: [{ totalCost: 20 }],
  repairs: [{ price: 100 }],
  status: "DELIVERED",
  updatedAt: new Date("2026-01-12T10:00:00Z"),
};

describe("report row margin vs summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revenue breakdown row matches the summary margin", async () => {
    (aggregateJobRevenue as ReturnType<typeof vi.fn>).mockResolvedValue([
      { revenue: "120" },
    ]);
    (aggregateJobDeposits as ReturnType<typeof vi.fn>).mockResolvedValue({
      _sum: { depositAmount: null },
    });
    (aggregateOutstandingJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { balance: "0", count: 0 },
    ]);
    (queryRawProfitMargin as ReturnType<typeof vi.fn>).mockResolvedValue([
      { cost: "115" },
    ]);
    (findRevenueBreakdown as ReturnType<typeof vi.fn>).mockResolvedValue([
      JOB_ROW,
    ]);

    const report = await revenueReport(prisma, ownerScope, range, true);

    expect(report.summary.avgProfitMargin).toBe(4.17);
    expect(report.breakdown[0]?.margin).toBe(4.17);
  });

  it("orders row matches the summary margin", async () => {
    (findOrdersForReport as ReturnType<typeof vi.fn>).mockResolvedValue([
      JOB_ROW,
    ]);

    const report = await ordersReport(
      prisma,
      ownerScope,
      range,
      undefined,
      true
    );

    expect(report.summary.avgMargin).toBe(4.17);
    expect(report.rows[0]?.margin).toBe(4.17);
    expect(report.rows[0]?.totalValue).toBe(120);
  });
});
