import { beforeEach, describe, expect, it, vi } from "vitest";
import { notify } from "../notification-dispatch.js";
import {
  create,
  detachRework,
  getById,
  list,
  removePhoto,
  resolve,
  spawnRework,
  triage,
  uploadPhoto,
} from "../return-claim.service.js";

vi.mock("../notification-dispatch.js", () => ({ notify: vi.fn() }));

type AnyFn = ReturnType<typeof vi.fn>;

function mockPrisma() {
  const mock = {
    job: { findUnique: vi.fn(), update: vi.fn() } as Record<string, AnyFn>,
    jobRepair: { findUnique: vi.fn() } as Record<string, AnyFn>,
    jobPart: { findUnique: vi.fn() } as Record<string, AnyFn>,
    jobPhoto: { update: vi.fn() } as Record<string, AnyFn>,
    returnClaim: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    } as Record<string, AnyFn>,
    shopSettings: { findFirst: vi.fn() } as Record<string, AnyFn>,
    auditLog: { findFirst: vi.fn() } as Record<string, AnyFn>,
    $transaction: vi.fn() as AnyFn,
  } as unknown as {
    job: Record<string, AnyFn>;
    jobRepair: Record<string, AnyFn>;
    jobPart: Record<string, AnyFn>;
    jobPhoto: Record<string, AnyFn>;
    returnClaim: Record<string, AnyFn>;
    shopSettings: Record<string, AnyFn>;
    auditLog: Record<string, AnyFn>;
    $transaction: AnyFn;
  };

  mock.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(mock)
  );

  return mock;
}

describe("create", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns JOB_NOT_FOUND when original job does not exist", async () => {
    prisma.job.findUnique.mockResolvedValue(null);

    const result = await create(
      prisma as never,
      { originalJobId: "missing", returnReason: "test" },
      "user-1"
    );

    expect(result).toEqual({ error: "JOB_NOT_FOUND" });
  });

  it("returns ORIGINAL_JOB_NOT_DELIVERED when job is not at DELIVERED", async () => {
    prisma.job.findUnique.mockResolvedValue({
      id: "job-1",
      status: "IN_REPAIR",
    });

    const result = await create(
      prisma as never,
      { originalJobId: "job-1", returnReason: "broken again" },
      "user-1"
    );

    expect(result).toEqual({ error: "ORIGINAL_JOB_NOT_DELIVERED" });
    expect(prisma.returnClaim.create).not.toHaveBeenCalled();
  });

  it("returns INVALID_CLAIMED_LINE when claimedJobRepairId belongs to a different job", async () => {
    prisma.job.findUnique.mockResolvedValue({
      id: "job-1",
      status: "DELIVERED",
      customerId: "c1",
    });
    prisma.jobRepair.findUnique.mockResolvedValue({
      id: "jr-1",
      jobId: "job-2",
    });

    const result = await create(
      prisma as never,
      {
        originalJobId: "job-1",
        claimedJobRepairId: "jr-1",
        returnReason: "screen flickers",
      },
      "user-1"
    );

    expect(result).toEqual({ error: "INVALID_CLAIMED_LINE" });
  });

  it("returns INVALID_CLAIMED_LINE when claimedJobPartId belongs to a different job", async () => {
    prisma.job.findUnique.mockResolvedValue({
      id: "job-1",
      status: "DELIVERED",
      customerId: "c1",
    });
    prisma.jobPart.findUnique.mockResolvedValue({ id: "jp-1", jobId: "job-2" });

    const result = await create(
      prisma as never,
      {
        originalJobId: "job-1",
        claimedJobPartId: "jp-1",
        returnReason: "battery dead",
      },
      "user-1"
    );

    expect(result).toEqual({ error: "INVALID_CLAIMED_LINE" });
  });

  it("creates an OPEN claim when inputs are valid (no specific line)", async () => {
    prisma.job.findUnique.mockResolvedValue({
      id: "job-1",
      status: "DELIVERED",
      customerId: "c1",
    });
    prisma.returnClaim.create.mockResolvedValue({ id: "rc-1" });

    const result = await create(
      prisma as never,
      { originalJobId: "job-1", returnReason: "device making weird noise" },
      "user-1"
    );

    expect(result).toEqual({ id: "rc-1" });
    expect(prisma.returnClaim.create).toHaveBeenCalledWith({
      data: {
        originalJobId: "job-1",
        claimedJobRepairId: undefined,
        claimedJobPartId: undefined,
        returnReason: "device making weird noise",
        openedById: "user-1",
      },
      select: { id: true },
    });
  });
});

describe("getById", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when claim not found", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue(null);
    const result = await getById(prisma as never, "missing");
    expect(result).toBeNull();
  });

  it("returns claim with relations when found", async () => {
    const claim = {
      id: "rc-1",
      status: "OPEN",
      originalJob: { id: "job-1", jobCode: "RPR-001", repairs: [] },
      openedAt: new Date(),
    };
    prisma.returnClaim.findUnique.mockResolvedValue(claim);
    prisma.shopSettings.findFirst.mockResolvedValue({
      defaultWarrantyDays: 30,
    });
    prisma.auditLog.findFirst.mockResolvedValue(null);
    const result = await getById(prisma as never, "rc-1");
    expect(result).toMatchObject({ id: "rc-1" });
    expect(prisma.returnClaim.findUnique).toHaveBeenCalledWith({
      where: { id: "rc-1" },
      include: expect.any(Object),
    });
  });
});

describe("list", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("applies status, faultCategory, and date filters", async () => {
    prisma.returnClaim.findMany.mockResolvedValue([]);
    prisma.returnClaim.count.mockResolvedValue(0);

    await list(prisma as never, {
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.999Z",
      page: 2,
      limit: 10,
    });

    expect(prisma.returnClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "OPEN",
          faultCategory: "WORKMANSHIP",
          openedAt: {
            gte: new Date("2026-01-01T00:00:00.000Z"),
            lte: new Date("2026-12-31T23:59:59.999Z"),
          },
        }),
        skip: 10,
        take: 10,
      })
    );
  });

  it("scopes by technicianId when provided", async () => {
    prisma.returnClaim.findMany.mockResolvedValue([]);
    prisma.returnClaim.count.mockResolvedValue(0);

    await list(prisma as never, { technicianId: "tech-1" });

    expect(prisma.returnClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { originalJob: { technicianId: "tech-1" } },
            { reworkJob: { technicianId: "tech-1" } },
          ],
        }),
      })
    );
  });

  it("returns paginated shape", async () => {
    prisma.returnClaim.findMany.mockResolvedValue([{ id: "rc-1" }]);
    prisma.returnClaim.count.mockResolvedValue(1);

    const result = await list(prisma as never, {});

    expect(result).toEqual({
      items: [{ id: "rc-1" }],
      total: 1,
      page: 1,
      limit: 20,
    });
  });
});

describe("triage", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns RETURN_CLAIM_NOT_FOUND when claim missing", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue(null);
    const result = await triage(prisma as never, "missing", {
      faultCategory: "WORKMANSHIP",
    });
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_FOUND" });
  });

  it("returns RETURN_CLAIM_NOT_OPEN when claim already RESOLVED", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });
    const result = await triage(prisma as never, "rc-1", {
      faultCategory: "WORKMANSHIP",
    });
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_OPEN" });
  });

  it("updates faultCategory on OPEN claim", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
    });
    prisma.returnClaim.update.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
    });

    const result = await triage(prisma as never, "rc-1", {
      faultCategory: "WORKMANSHIP",
    });

    expect(prisma.returnClaim.update).toHaveBeenCalledWith({
      where: { id: "rc-1" },
      data: { faultCategory: "WORKMANSHIP" },
    });
    expect(result).toMatchObject({ id: "rc-1", faultCategory: "WORKMANSHIP" });
  });
});

describe("spawnRework", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns RETURN_CLAIM_NOT_FOUND when missing", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue(null);
    const result = await spawnRework(prisma as never, "missing", "user-1");
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_FOUND" });
  });

  it("returns RETURN_CLAIM_NOT_OPEN when claim already RESOLVED", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });
    const result = await spawnRework(prisma as never, "rc-1", "user-1");
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_OPEN" });
  });

  it("returns RETURN_CLAIM_HAS_REWORK_JOB when reworkJobId already set", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      reworkJobId: "rework-1",
    });
    const result = await spawnRework(prisma as never, "rc-1", "user-1");
    expect(result).toEqual({ error: "RETURN_CLAIM_HAS_REWORK_JOB" });
  });
});

describe("detachRework", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns RETURN_CLAIM_NOT_OPEN when RESOLVED", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });
    const result = await detachRework(prisma as never, "rc-1");
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_OPEN" });
  });

  it("nulls reworkJobId on OPEN claim", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      reworkJobId: "rework-1",
    });
    prisma.returnClaim.update.mockResolvedValue({
      id: "rc-1",
      reworkJobId: null,
    });

    const result = await detachRework(prisma as never, "rc-1");

    expect(prisma.returnClaim.update).toHaveBeenCalledWith({
      where: { id: "rc-1" },
      data: { reworkJobId: null },
      select: { id: true, reworkJobId: true },
    });
    expect(result).toMatchObject({ id: "rc-1", reworkJobId: null });
  });
});

describe("resolve", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    vi.clearAllMocks();
  });

  it("returns RETURN_CLAIM_FAULT_REQUIRED when faultCategory not set", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: null,
    });

    const result = await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REWORK_FREE" },
      "user-1"
    );

    expect(result).toEqual({ error: "RETURN_CLAIM_FAULT_REQUIRED" });
  });

  it("returns RETURN_CLAIM_REWORK_JOB_REQUIRED when no rework job exists", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
      reworkJobId: null,
      reworkJob: null,
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });

    const result = await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REWORK_FREE" },
      "user-1"
    );

    expect(result).toEqual({ error: "RETURN_CLAIM_REWORK_JOB_REQUIRED" });
  });

  it("returns RETURN_CLAIM_REWORK_JOB_NOT_DELIVERED when rework job not delivered", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
      reworkJobId: "rework-1",
      reworkJob: { id: "rework-1", status: "IN_REPAIR" },
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });

    const result = await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REWORK_FREE" },
      "user-1"
    );

    expect(result).toEqual({ error: "RETURN_CLAIM_REWORK_JOB_NOT_DELIVERED" });
  });

  it("resolves REWORK_FREE when rework Job is DELIVERED", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
      reworkJobId: "rework-1",
      reworkJob: { id: "rework-1", status: "DELIVERED" },
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });
    prisma.returnClaim.update.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });

    const result = await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REWORK_FREE" },
      "user-1"
    );

    expect(prisma.returnClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RESOLVED",
          resolutionOutcome: "REWORK_FREE",
          resolvedById: "user-1",
          resolvedAt: expect.any(Date),
        }),
      })
    );
    expect(result).toMatchObject({ id: "rc-1", status: "RESOLVED" });
  });

  it("resolves REWORK_PARTIAL_CHARGE with partialChargeAmount", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "DEFECTIVE_PART",
      reworkJobId: "rework-1",
      reworkJob: { id: "rework-1", status: "DELIVERED" },
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });
    prisma.returnClaim.update.mockResolvedValue({ id: "rc-1" });

    await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REWORK_PARTIAL_CHARGE", partialChargeAmount: 1500 },
      "user-1"
    );

    expect(prisma.returnClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolutionOutcome: "REWORK_PARTIAL_CHARGE",
          partialChargeAmount: 1500,
        }),
      })
    );
  });

  it("returns REFUND_EXCEEDS_ORIGINAL when refundAmount > original payment", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "MISDIAGNOSIS",
      reworkJobId: null,
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });
    prisma.job.findUnique.mockResolvedValue({
      id: "job-1",
      depositAmount: 1000,
      payments: [{ amount: 500 }],
    });

    const result = await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REFUND_FULL", refundAmount: 99_999 },
      "user-1"
    );

    expect(result).toEqual({ error: "REFUND_EXCEEDS_ORIGINAL" });
  });

  it("resolves REFUND_PARTIAL when refundAmount valid", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
      reworkJobId: null,
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });
    prisma.job.findUnique.mockResolvedValue({
      id: "job-1",
      depositAmount: 1000,
      payments: [{ amount: 4000 }],
    });
    prisma.returnClaim.update.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });

    await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REFUND_PARTIAL", refundAmount: 2000 },
      "user-1"
    );

    expect(prisma.returnClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolutionOutcome: "REFUND_PARTIAL",
          refundAmount: 2000,
        }),
      })
    );
  });

  it("calls notify with return_claim_resolved on REFUND_FULL", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "MISDIAGNOSIS",
      reworkJobId: null,
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });
    prisma.job.findUnique.mockResolvedValue({
      depositAmount: 0,
      payments: [{ amount: 3000 }, { amount: 2000 }],
    });
    prisma.returnClaim.update.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });

    await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REFUND_FULL", refundAmount: 5000 },
      "user-1"
    );

    expect(notify).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eventName: "return_claim_resolved",
        jobId: "job-1",
        context: expect.objectContaining({
          jobCode: "RPR-001",
          outcome: "REFUND_FULL",
        }),
        recipients: { role: "OWNER" },
      })
    );
  });

  it("does not call notify on REWORK_FREE", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      faultCategory: "WORKMANSHIP",
      reworkJobId: "rework-1",
      reworkJob: { id: "rework-1", status: "DELIVERED" },
      originalJobId: "job-1",
      originalJob: { jobCode: "RPR-001" },
    });
    prisma.returnClaim.update.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });

    await resolve(
      prisma as never,
      "rc-1",
      { resolutionOutcome: "REWORK_FREE" },
      "user-1"
    );

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("uploadPhoto", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns RETURN_CLAIM_NOT_OPEN when claim is RESOLVED", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
      originalJobId: "job-1",
    });

    const fakeFile = { filename: "x.jpg" } as never;
    const result = await uploadPhoto(
      prisma as never,
      "rc-1",
      fakeFile,
      "RETURN_INTAKE",
      "user-1"
    );
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_OPEN" });
  });

  it("returns RETURN_CLAIM_NOT_FOUND when claim missing", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue(null);
    const fakeFile = { filename: "x.jpg" } as never;
    const result = await uploadPhoto(
      prisma as never,
      "missing",
      fakeFile,
      "RETURN_INTAKE",
      "user-1"
    );
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_FOUND" });
  });
});

describe("removePhoto", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns RETURN_CLAIM_NOT_OPEN when claim is RESOLVED", async () => {
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "RESOLVED",
    });
    const result = await removePhoto(prisma as never, "rc-1", "ph-1", "user-1");
    expect(result).toEqual({ error: "RETURN_CLAIM_NOT_OPEN" });
  });
});

describe("getById warranty hydration", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("includes deliveredAt + isInWarranty on the claim", async () => {
    const deliveredAt = new Date("2026-04-01T10:00:00Z");
    prisma.returnClaim.findUnique.mockResolvedValue({
      id: "rc-1",
      status: "OPEN",
      openedAt: new Date("2026-04-15T10:00:00Z"),
      originalJob: {
        id: "job-1",
        jobCode: "RPR-001",
        repairs: [
          { id: "jr-1", repairName: "Screen", repair: { warrantyDays: 60 } },
          { id: "jr-2", repairName: "Battery", repair: { warrantyDays: null } },
        ],
      },
      claimedJobRepair: { id: "jr-1" },
      claimedJobPart: null,
    });
    prisma.shopSettings.findFirst.mockResolvedValue({
      defaultWarrantyDays: 30,
    });
    prisma.auditLog.findFirst.mockResolvedValue({ createdAt: deliveredAt });

    const result = await getById(prisma as never, "rc-1");

    expect(result).toMatchObject({
      id: "rc-1",
      warrantyInfo: {
        deliveredAt,
        claimedLineWarrantyDays: 60,
        isInWarrantyAtOpen: true,
      },
    });
  });
});
