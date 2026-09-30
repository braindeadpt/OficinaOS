import type { Scope } from "@shared/types/dashboard";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeJobsCount,
  activeRepairsQueue,
  avgProfitMargin,
  avgRepairTimeHours,
  completedTodayCount,
  financialTrend,
  overdueJobs,
  pickupReady,
  pipelineCounts,
  priorityActionsForTech,
  priorityAlerts,
  recentActivityForTech,
  revenueThisMonth,
  todayOverview,
  todayScheduleForTech,
  warrantyReturnsOpen,
} from "../services/dashboard.service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ownerScope: Scope = {
  role: "OWNER",
  shopTz: "UTC",
  userId: "owner-1",
};

const techScope: Scope = {
  role: "TECHNICIAN",
  shopTz: "UTC",
  userId: "tech-1",
};

const frontDeskScope: Scope = {
  role: "FRONT_DESK",
  shopTz: "UTC",
  userId: "desk-1",
};

const monthRange = {
  start: new Date("2025-04-01T00:00:00Z"),
  end: new Date("2025-05-01T00:00:00Z"),
};

const todayRange = {
  start: new Date("2025-04-26T00:00:00Z"),
  end: new Date("2025-04-27T00:00:00Z"),
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// pipelineCounts
// ---------------------------------------------------------------------------

describe("pipelineCounts", () => {
  it("returns zeroed map when no groups", async () => {
    const prisma = makePrisma();
    const result = await pipelineCounts(prisma, ownerScope);
    expect(result.CANCELLED).toBe(0);
    expect(result.DELIVERED).toBe(0);
    expect(result.IN_REPAIR).toBe(0);
    expect(result.INTAKE).toBe(0);
  });

  it("maps groupBy results into status counts", async () => {
    const prisma = makePrisma({
      job: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "IN_REPAIR", _count: { _all: 3 } },
          { status: "INTAKE", _count: { _all: 5 } },
        ]),
      },
    });
    const result = await pipelineCounts(prisma, ownerScope);
    expect(result.IN_REPAIR).toBe(3);
    expect(result.INTAKE).toBe(5);
    expect(result.DELIVERED).toBe(0);
  });

  it("filters by technicianId for tech scope", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ job: { groupBy } });
    await pipelineCounts(prisma, techScope);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { technicianId: "tech-1" },
      })
    );
  });

  it("no technician filter for owner scope", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ job: { groupBy } });
    await pipelineCounts(prisma, ownerScope);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

// ---------------------------------------------------------------------------
// activeJobsCount
// ---------------------------------------------------------------------------

describe("activeJobsCount", () => {
  it("returns count of active-status jobs", async () => {
    const prisma = makePrisma({
      job: { count: vi.fn().mockResolvedValue(7) },
    });
    const result = await activeJobsCount(prisma, ownerScope);
    expect(result).toBe(7);
  });

  it("scopes to technician when TECHNICIAN role", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const prisma = makePrisma({ job: { count } });
    await activeJobsCount(prisma, techScope);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ technicianId: "tech-1" }),
      })
    );
  });

  it("returns 0 for empty shop", async () => {
    const prisma = makePrisma();
    const result = await activeJobsCount(prisma, ownerScope);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// completedTodayCount
// ---------------------------------------------------------------------------

describe("completedTodayCount", () => {
  it("counts DELIVERED jobs within today range", async () => {
    const count = vi.fn().mockResolvedValue(4);
    const prisma = makePrisma({ job: { count } });
    const result = await completedTodayCount(prisma, ownerScope, todayRange);
    expect(result).toBe(4);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "DELIVERED",
          updatedAt: { gte: todayRange.start, lt: todayRange.end },
        }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// revenueThisMonth
// ---------------------------------------------------------------------------

describe("revenueThisMonth", () => {
  it("sums revenue from raw query rows", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([
        { revenue: "500", cost: "200" },
        { revenue: "300", cost: "100" },
      ]),
    });
    const result = await revenueThisMonth(prisma, ownerScope, monthRange);
    expect(result).toBe(800);
  });

  it("returns 0 when no rows", async () => {
    const prisma = makePrisma();
    const result = await revenueThisMonth(prisma, ownerScope, monthRange);
    expect(result).toBe(0);
  });

  it("passes date range params to raw query", async () => {
    const raw = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ $queryRaw: raw });
    await revenueThisMonth(prisma, ownerScope, monthRange);
    expect(raw).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.arrayContaining([monthRange.start, monthRange.end]),
      })
    );
  });

  it("adds technicianId param for TECHNICIAN scope", async () => {
    const raw = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({ $queryRaw: raw });
    await revenueThisMonth(prisma, techScope, monthRange);
    const call = raw.mock.calls[0][0];
    expect(call.strings.join("")).toContain("technicianId");
    expect(call.values).toEqual(
      expect.arrayContaining([monthRange.start, monthRange.end, "tech-1"])
    );
  });
});

// ---------------------------------------------------------------------------
// avgProfitMargin
// ---------------------------------------------------------------------------

describe("avgProfitMargin", () => {
  it("computes (revenue - cost) / revenue", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([{ revenue: "1000", cost: "400" }]),
    });
    const result = await avgProfitMargin(prisma, ownerScope, monthRange);
    expect(result).toBe(60);
  });

  it("returns 0 when revenue is 0", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([{ revenue: "0", cost: "0" }]),
    });
    const result = await avgProfitMargin(prisma, ownerScope, monthRange);
    expect(result).toBe(0);
  });

  it("returns 0 for empty results", async () => {
    const prisma = makePrisma();
    const result = await avgProfitMargin(prisma, ownerScope, monthRange);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// financialTrend
// ---------------------------------------------------------------------------

describe("financialTrend", () => {
  it("maps raw rows to FinancialTrendPoint array", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([
        { day: new Date("2025-04-24"), revenue: "500", cost: "200" },
        { day: new Date("2025-04-25"), revenue: "300", cost: "100" },
      ]),
    });
    const result = await financialTrend(prisma, ownerScope, 7);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2025-04-24");
    expect(result[0].revenue).toBe(500);
    expect(result[0].cost).toBe(200);
  });

  it("returns empty array when no data", async () => {
    const prisma = makePrisma();
    const result = await financialTrend(prisma, ownerScope, 7);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// overdueJobs
// ---------------------------------------------------------------------------

describe("overdueJobs", () => {
  it("maps job rows to OverdueJobDTO", async () => {
    const past = new Date(Date.now() - 7_200_000); // 2h ago
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j1",
        jobCode: "R-001",
        estimatedDate: past,
        customer: { name: "Alice" },
        device: { brand: { name: "Apple" }, model: "iPhone 15" },
        repairs: [{ repairName: "Screen" }],
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await overdueJobs(prisma, ownerScope, 5);

    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Alice");
    expect(result[0].device).toBe("Apple iPhone 15");
    expect(result[0].repairSummary).toBe("Screen");
    expect(result[0].hoursLate).toBeGreaterThanOrEqual(2);
  });

  it("uses fallback dash when no repairs", async () => {
    const past = new Date(Date.now() - 3_600_000);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j2",
        jobCode: "R-002",
        estimatedDate: past,
        customer: { name: "Bob" },
        device: { brand: { name: "Samsung" }, model: "S24" },
        repairs: [],
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await overdueJobs(prisma, ownerScope, 5);
    expect(result[0].repairSummary).toBe("—");
  });

  it("returns empty array when no overdue", async () => {
    const prisma = makePrisma();
    const result = await overdueJobs(prisma, ownerScope, 5);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// warrantyReturnsOpen
// ---------------------------------------------------------------------------

describe("warrantyReturnsOpen", () => {
  it("maps warranty return jobs to DTO", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j3",
        jobCode: "R-003",
        createdAt: new Date("2025-04-20"),
        reportedProblem: "Screen flickers after previous repair",
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await warrantyReturnsOpen(prisma, ownerScope, 5);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Screen flickers after previous repair");
    expect(result[0].jobCode).toBe("R-003");
  });

  it("truncates long reportedProblem to 80 chars", async () => {
    const longProblem = "A".repeat(120);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j4",
        jobCode: "R-004",
        createdAt: new Date(),
        reportedProblem: longProblem,
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await warrantyReturnsOpen(prisma, ownerScope, 5);
    expect(result[0].description).toHaveLength(80);
  });
});

// ---------------------------------------------------------------------------
// todayScheduleForTech
// ---------------------------------------------------------------------------

describe("todayScheduleForTech", () => {
  it("returns scheduled jobs for today", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([
      {
        id: "j5",
        jobCode: "R-005",
        estimatedDate: new Date("2025-04-26T10:00:00Z"),
        status: "IN_REPAIR",
        createdAt: new Date(),
        customer: { name: "Carol" },
        device: { brand: { name: "Pixel" }, model: "8" },
        repairs: [{ repairName: "Battery" }],
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await todayScheduleForTech(prisma, "tech-1", todayRange);
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Carol");
    expect(result[0].device).toBe("Pixel 8");
    expect(result[0].repairSummary).toBe("Battery");
  });

  it("falls back to active jobs when no scheduled jobs today", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([]) // scheduled = empty
      .mockResolvedValueOnce([
        {
          id: "j6",
          jobCode: "R-006",
          estimatedDate: null,
          status: "INTAKE",
          createdAt: new Date(),
          customer: { name: "Dave" },
          device: { brand: { name: "Xiaomi" }, model: "14" },
          repairs: [],
        },
      ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await todayScheduleForTech(prisma, "tech-1", todayRange);
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Dave");
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// recentActivityForTech
// ---------------------------------------------------------------------------

describe("recentActivityForTech", () => {
  it("maps audit log rows to ActivityItemDTO", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "log-1",
        action: "STATUS_CHANGE",
        fromValue: "INTAKE",
        toValue: "IN_REPAIR",
        createdAt: new Date("2025-04-26T12:00:00Z"),
        job: { jobCode: "R-007" },
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });
    const result = await recentActivityForTech(prisma, "tech-1", 10);
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("STATUS_CHANGE");
    expect(result[0].fromValue).toBe("INTAKE");
    expect(result[0].jobCode).toBe("R-007");
  });

  it("handles null job code", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "log-2",
        action: "LOGIN",
        fromValue: null,
        toValue: null,
        createdAt: new Date(),
        job: null,
      },
    ]);
    const prisma = makePrisma({ auditLog: { findMany } });
    const result = await recentActivityForTech(prisma, "tech-1", 10);
    expect(result[0].jobCode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// avgRepairTimeHours
// ---------------------------------------------------------------------------

describe("avgRepairTimeHours", () => {
  it("computes average from created→updated deltas", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        createdAt: new Date("2025-04-24T08:00:00Z"),
        updatedAt: new Date("2025-04-24T18:00:00Z"),
      },
      {
        createdAt: new Date("2025-04-24T08:00:00Z"),
        updatedAt: new Date("2025-04-24T13:00:00Z"),
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await avgRepairTimeHours(prisma, "tech-1", 30);
    // (10h + 5h) / 2 = 7.5
    expect(result).toBe(7.5);
  });

  it("returns 0 when no completed jobs", async () => {
    const prisma = makePrisma();
    const result = await avgRepairTimeHours(prisma, "tech-1", 30);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// priorityActionsForTech
// ---------------------------------------------------------------------------

describe("priorityActionsForTech", () => {
  it("runs three counts in parallel and returns object", async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(2) // stale
      .mockResolvedValueOnce(1) // overdue
      .mockResolvedValueOnce(3); // waiting
    const prisma = makePrisma({
      job: { count, findMany: vi.fn(), groupBy: vi.fn() },
    });
    const result = await priorityActionsForTech(prisma, "tech-1");
    expect(result).toEqual({
      jobsNeedingStatusUpdate: 2,
      overdueCount: 1,
      partsWaitingCount: 3,
    });
    expect(count).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// activeRepairsQueue (front-desk)
// ---------------------------------------------------------------------------

describe("activeRepairsQueue", () => {
  it("maps job rows to ActiveRepairDTO", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j7",
        jobCode: "R-008",
        status: "IN_REPAIR",
        estimatedDate: new Date("2025-04-28"),
        updatedAt: new Date("2025-04-26T10:00:00Z"),
        customer: { name: "Eve" },
        device: { brand: { name: "OnePlus" }, model: "12" },
        technician: { name: "Tech A", username: "techa" },
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await activeRepairsQueue(
      prisma,
      frontDeskScope,
      todayRange,
      10
    );
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Eve");
    expect(result[0].deviceModel).toBe("OnePlus 12");
    expect(result[0].technicianName).toBe("Tech A");
  });

  it("falls back to username when technician name is null", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j8",
        jobCode: "R-009",
        status: "INTAKE",
        estimatedDate: null,
        updatedAt: new Date(),
        customer: { name: "Frank" },
        device: { brand: { name: "Nokia" }, model: "G60" },
        technician: { name: null, username: "techb" },
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await activeRepairsQueue(
      prisma,
      frontDeskScope,
      todayRange,
      10
    );
    expect(result[0].technicianName).toBe("techb");
  });

  it("returns null technicianName when both name and username are null", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j9",
        jobCode: "R-010",
        status: "INTAKE",
        estimatedDate: null,
        updatedAt: new Date(),
        customer: { name: "Grace" },
        device: { brand: { name: "Motorola" }, model: "Edge" },
        technician: null,
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await activeRepairsQueue(
      prisma,
      frontDeskScope,
      todayRange,
      10
    );
    expect(result[0].technicianName).toBeNull();
  });

  it("returns empty array for no repairs", async () => {
    const prisma = makePrisma();
    const result = await activeRepairsQueue(
      prisma,
      frontDeskScope,
      todayRange,
      10
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// todayOverview (front-desk)
// ---------------------------------------------------------------------------

describe("todayOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns totalToday, completedToday, recentIntakes", async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(10) // totalToday
      .mockResolvedValueOnce(3); // completedToday
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j10",
        jobCode: "R-011",
        createdAt: new Date("2025-04-26T08:00:00Z"),
        device: { brand: { name: "Apple" }, model: "iPhone 14" },
      },
    ]);
    const prisma = makePrisma({ job: { count, findMany, groupBy: vi.fn() } });
    const result = await todayOverview(prisma, frontDeskScope, todayRange);
    expect(result.totalToday).toBe(10);
    expect(result.completedToday).toBe(3);
    expect(result.recentIntakes).toHaveLength(1);
    expect(result.recentIntakes[0].deviceModel).toBe("Apple iPhone 14");
  });

  it("handles zero jobs gracefully", async () => {
    const prisma = makePrisma();
    const result = await todayOverview(prisma, frontDeskScope, todayRange);
    expect(result.totalToday).toBe(0);
    expect(result.completedToday).toBe(0);
    expect(result.recentIntakes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// pickupReady (front-desk)
// ---------------------------------------------------------------------------

describe("pickupReady", () => {
  it("maps DONE-status jobs to PickupReadyDTO", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "j11",
        jobCode: "R-012",
        updatedAt: new Date("2025-04-25T16:00:00Z"),
        customer: { name: "Heidi", phone: "+1234567890" },
        device: { brand: { name: "Sony" }, model: "Xperia 5" },
      },
    ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await pickupReady(prisma, frontDeskScope, 5);
    expect(result).toHaveLength(1);
    expect(result[0].customerName).toBe("Heidi");
    expect(result[0].customerPhone).toBe("+1234567890");
    expect(result[0].deviceModel).toBe("Sony Xperia 5");
  });

  it("returns empty array when none ready", async () => {
    const prisma = makePrisma();
    const result = await pickupReady(prisma, frontDeskScope, 5);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// priorityAlerts (front-desk)
// ---------------------------------------------------------------------------

describe("priorityAlerts", () => {
  it("merges overdue, warranty, and pickup-ready alerts sorted by ts", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        // overdue
        {
          id: "od1",
          jobCode: "R-013",
          updatedAt: new Date("2025-04-26T08:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([
        // warranty
        {
          id: "wr1",
          jobCode: "R-014",
          updatedAt: new Date("2025-04-26T09:00:00Z"),
          customer: { name: "Ivan" },
        },
      ])
      .mockResolvedValueOnce([
        // ready for pickup
        {
          id: "rp1",
          jobCode: "R-015",
          updatedAt: new Date("2025-04-26T10:00:00Z"),
          customer: { name: "Judy" },
        },
      ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await priorityAlerts(prisma, frontDeskScope, 10);

    expect(result).toHaveLength(3);
    // Sorted by ts descending → newest first
    expect(result[0].kind).toBe("READY_FOR_PICKUP");
    expect(result[1].kind).toBe("WARRANTY_RETURN");
    expect(result[2].kind).toBe("OVERDUE");
  });

  it("prefixes ids by kind", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "x1", jobCode: "R-020", updatedAt: new Date() },
      ])
      .mockResolvedValueOnce([
        {
          id: "x2",
          jobCode: "R-021",
          updatedAt: new Date(),
          customer: { name: "A" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "x3",
          jobCode: "R-022",
          updatedAt: new Date(),
          customer: { name: "B" },
        },
      ]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    const result = await priorityAlerts(prisma, frontDeskScope, 10);
    const ids = result.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["od-x1", "wr-x2", "rp-x3"]));
  });

  it("returns empty array when no alerts", async () => {
    const prisma = makePrisma();
    const result = await priorityAlerts(prisma, frontDeskScope, 10);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cross-role scope filtering
// ---------------------------------------------------------------------------

describe("role-based scope filtering", () => {
  it("TECHNICIAN scope adds technicianId filter to findMany queries", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    await overdueJobs(prisma, techScope, 5);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ technicianId: "tech-1" }),
      })
    );
  });

  it("FRONT_DESK scope does not add technicianId filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    await overdueJobs(prisma, frontDeskScope, 5);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ technicianId: expect.anything() }),
      })
    );
  });

  it("OWNER scope does not add technicianId filter", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = makePrisma({
      job: { findMany, count: vi.fn(), groupBy: vi.fn() },
    });
    await overdueJobs(prisma, ownerScope, 5);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ technicianId: expect.anything() }),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Empty-data edge cases (owner)
// ---------------------------------------------------------------------------

describe("empty data (zero revenue / zero jobs)", () => {
  it("revenueThisMonth returns 0 with no delivered jobs", async () => {
    const prisma = makePrisma();
    const result = await revenueThisMonth(prisma, ownerScope, monthRange);
    expect(result).toBe(0);
  });

  it("avgProfitMargin returns 0 with no revenue", async () => {
    const prisma = makePrisma({
      $queryRaw: vi.fn().mockResolvedValue([{ revenue: "0", cost: "0" }]),
    });
    const result = await avgProfitMargin(prisma, ownerScope, monthRange);
    expect(result).toBe(0);
  });

  it("financialTrend returns empty array with no data", async () => {
    const prisma = makePrisma();
    const result = await financialTrend(prisma, ownerScope, 7);
    expect(result).toEqual([]);
  });

  it("overdueJobs returns empty array", async () => {
    const prisma = makePrisma();
    const result = await overdueJobs(prisma, ownerScope, 5);
    expect(result).toEqual([]);
  });

  it("warrantyReturnsOpen returns empty array", async () => {
    const prisma = makePrisma();
    const result = await warrantyReturnsOpen(prisma, ownerScope, 5);
    expect(result).toEqual([]);
  });

  it("activeJobsCount returns 0", async () => {
    const prisma = makePrisma();
    const result = await activeJobsCount(prisma, ownerScope);
    expect(result).toBe(0);
  });

  it("pickupReady returns empty array", async () => {
    const prisma = makePrisma();
    const result = await pickupReady(prisma, frontDeskScope, 5);
    expect(result).toEqual([]);
  });

  it("priorityAlerts returns empty array", async () => {
    const prisma = makePrisma();
    const result = await priorityAlerts(prisma, frontDeskScope, 10);
    expect(result).toEqual([]);
  });
});
