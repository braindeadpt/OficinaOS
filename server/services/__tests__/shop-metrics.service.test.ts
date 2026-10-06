import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cloudFetch: vi.fn(),
}));

vi.mock("../cloud.service.js", () => ({
  cloudFetch: mocks.cloudFetch,
}));

import {
  computeDailyMetrics,
  syncShopMetrics,
} from "../shop-metrics.service.js";

const log = {
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as never;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fakePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    salePayment: {
      aggregate: vi.fn(async () => ({ _sum: { amount: 50.25 } })),
    },
    payment: {
      aggregate: vi.fn(async () => ({ _sum: { amount: 30 } })),
    },
    job: {
      count: vi
        .fn()
        // 1st call: jobsOpened · 2nd: jobsDelivered · 3rd: activeJobs
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(7),
    },
    sale: {
      count: vi.fn(async () => 4),
      aggregate: vi.fn(async () => ({ _sum: { total: 123.45 } })),
    },
    customer: { count: vi.fn(async () => 2) },
    ...overrides,
  };
  return base as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cloudFetch.mockResolvedValue({ ok: true, status: 200, body: {} });
});

describe("computeDailyMetrics", () => {
  it("aggregates payments, jobs, sales and customers for the day", async () => {
    const prisma = fakePrisma();
    const m = await computeDailyMetrics(prisma, new Date(2026, 9, 14, 15, 30));

    expect(m).toEqual({
      date: "2026-10-14",
      revenueCents: 8025, // 50.25€ POS + 30.00€ reparações
      jobsOpened: 3,
      jobsDelivered: 2,
      salesCount: 4,
      salesCents: 12_345,
      activeJobs: 7,
      newCustomers: 2,
    });
  });

  it("queries use local-day bounds, not UTC", async () => {
    const prisma = fakePrisma();
    await computeDailyMetrics(prisma, new Date(2026, 0, 5, 23, 59));

    const p = prisma as unknown as {
      salePayment: { aggregate: ReturnType<typeof vi.fn> };
      job: { count: ReturnType<typeof vi.fn> };
    };
    const range = p.salePayment.aggregate.mock.calls[0][0].where.createdAt as {
      gte: Date;
      lt: Date;
    };
    expect(range.gte.getHours()).toBe(0);
    expect(range.gte.getMinutes()).toBe(0);
    expect(range.lt.getTime() - range.gte.getTime()).toBe(86_400_000);

    // activeJobs is a point-in-time count — no date filter, excludes finals.
    const activeCall = p.job.count.mock.calls[2][0];
    expect(activeCall.where.status.notIn).toEqual([
      "DELIVERED",
      "CANCELLED",
      "RETURNED",
    ]);
    expect(activeCall.where.updatedAt).toBeUndefined();
  });
});

describe("syncShopMetrics", () => {
  it("posts today and yesterday to the cloud", async () => {
    const prisma = fakePrisma();
    await syncShopMetrics(prisma, "https://cloud", "tok", log);

    expect(mocks.cloudFetch).toHaveBeenCalledWith(
      "https://cloud",
      "/shops/metrics",
      expect.objectContaining({
        method: "POST",
        token: "tok",
        body: {
          days: [
            expect.objectContaining({ revenueCents: 8025 }),
            expect.objectContaining({ revenueCents: 8025 }),
          ],
        },
      })
    );
    const days = (
      mocks.cloudFetch.mock.calls[0][2] as {
        body: { days: { date: string }[] };
      }
    ).body.days;
    // dates must differ (yesterday, today) in local YYYY-MM-DD form
    expect(days[0].date).not.toBe(days[1].date);
    expect(days[0].date).toMatch(DATE_RE);
  });

  it("warns and continues when the cloud is unreachable", async () => {
    mocks.cloudFetch.mockRejectedValue(new Error("conn refused"));
    const prisma = fakePrisma();
    await expect(
      syncShopMetrics(prisma, "https://cloud", "tok", log)
    ).resolves.toBeUndefined();
  });

  it("warns on non-ok response", async () => {
    mocks.cloudFetch.mockResolvedValue({ ok: false, status: 402, body: {} });
    const prisma = fakePrisma();
    await syncShopMetrics(prisma, "https://cloud", "tok", log);
    expect(
      (log as unknown as { warn: ReturnType<typeof vi.fn> }).warn
    ).toHaveBeenCalledWith(
      expect.objectContaining({ status: 402 }),
      "shop-metrics push rejected"
    );
  });
});
