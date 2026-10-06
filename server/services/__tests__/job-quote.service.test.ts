import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAndSendQuote,
  listQuotes,
  respondToQuote,
} from "../job-quote.service";

const mockCreateAuditLog = vi.hoisted(() => vi.fn());
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../audit.service.js", () => ({
  createAuditLog: mockCreateAuditLog,
}));

vi.mock("../notification-dispatch.js", () => ({
  notify: mockNotify,
}));

function mockPrisma(
  overrides: Partial<Record<keyof PrismaClient, unknown>> = {}
) {
  const mock = {
    job: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      ...((overrides as Record<string, unknown>).job || {}),
    },
    jobQuote: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      ...((overrides as Record<string, unknown>).jobQuote || {}),
    },
    $transaction: vi.fn((callback: (client: typeof mock) => Promise<unknown>) =>
      callback(mock)
    ),
    ...overrides,
  };
  return mock as unknown as PrismaClient;
}

const notifyCtx = { prisma: {} as PrismaClient, wsBroadcast: undefined };

const baseJob = {
  id: "job-1",
  jobCode: "JOB-2026-0001",
  createdById: "user-1",
  customer: { name: "Maria", phone: "+351 912 345 678" },
};

const sentQuote = {
  id: "quote-1",
  jobId: "job-1",
  version: 1,
  amount: { toNumber: () => 120 },
  note: null,
  status: "SENT",
  sentAt: new Date("2026-09-29T10:00:00Z"),
  respondedAt: null,
  responseNote: null,
};

describe("listQuotes", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
  });

  it("returns null when job does not exist", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await listQuotes(prisma, "missing");
    expect(result).toBeNull();
  });

  it("returns quotes for an existing job", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
    });
    (prisma.jobQuote.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      sentQuote,
    ]);
    const result = await listQuotes(prisma, "job-1");
    expect(result).toEqual([sentQuote]);
  });
});

describe("createAndSendQuote", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    mockCreateAuditLog.mockClear();
  });

  it("returns null when job does not exist", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await createAndSendQuote(
      prisma,
      "missing",
      {},
      "user-1",
      notifyCtx
    );
    expect(result).toBeNull();
  });

  it("creates version 1 defaulting amount to the job estimate", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      jobCode: "JOB-2026-0001",
      estimatedCost: { toNumber: () => 80 },
    });
    (prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );
    (prisma.jobQuote.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      sentQuote
    );

    const result = await createAndSendQuote(
      prisma,
      "job-1",
      {},
      "user-1",
      notifyCtx
    );

    expect(prisma.jobQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, status: "SENT" }),
      })
    );
    expect(result).toEqual(sentQuote);
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: "QUOTE_SENT", jobId: "job-1" })
    );
  });

  it("requires an explicit amount when the job has no estimate yet", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      jobCode: "JOB-2026-0001",
      estimatedCost: null,
    });

    await expect(
      createAndSendQuote(prisma, "job-1", {}, "user-1", notifyCtx)
    ).rejects.toMatchObject({ code: "QUOTE_AMOUNT_REQUIRED" });
    expect(prisma.jobQuote.create).not.toHaveBeenCalled();
  });

  it("supersedes the pending quote and bumps the version on resend", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      jobCode: "JOB-2026-0001",
      estimatedCost: 80,
    });
    (prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      sentQuote
    );
    (prisma.jobQuote.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sentQuote,
      id: "quote-2",
      version: 2,
    });

    await createAndSendQuote(
      prisma,
      "job-1",
      { amount: 150, note: "revised" },
      "user-1",
      notifyCtx
    );

    expect(prisma.jobQuote.updateMany).toHaveBeenCalledWith({
      where: { jobId: "job-1", status: "SENT" },
      data: { status: "SUPERSEDED" },
    });
    expect(prisma.jobQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          version: 2,
          amount: 150,
          note: "revised",
        }),
      })
    );
  });

  it("notifies the customer that a quote is ready", async () => {
    (prisma.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseJob,
      estimatedCost: 80,
    });
    (prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );
    (prisma.jobQuote.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      sentQuote
    );

    await createAndSendQuote(prisma, "job-1", {}, "user-1", notifyCtx);

    expect(mockNotify).toHaveBeenCalledWith(
      notifyCtx,
      expect.objectContaining({
        eventName: "quote_sent",
        jobId: "job-1",
        context: expect.objectContaining({
          customerName: "Maria",
          jobCode: "JOB-2026-0001",
          quoteAmount: "120,00",
          recipientPhone: "+351 912 345 678",
        }),
      })
    );
  });
});

describe("respondToQuote", () => {
  let prisma: ReturnType<typeof mockPrisma>;

  beforeEach(() => {
    prisma = mockPrisma();
    mockCreateAuditLog.mockClear();
    mockNotify.mockClear();
  });

  it("returns jobExists: false when the job code is unknown", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await respondToQuote(
      prisma,
      {
        code: "NOPE",
        phone4: "5678",
        quoteId: "quote-1",
        decision: "approve",
      },
      notifyCtx
    );
    expect(result.jobExists).toBe(false);
  });

  it("returns PHONE_MISMATCH when the last 4 digits do not match", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "0000",
        quoteId: "quote-1",
        decision: "approve",
      },
      notifyCtx
    );
    expect(result).toEqual({ error: "PHONE_MISMATCH", jobExists: true });
    expect(prisma.jobQuote.updateMany).not.toHaveBeenCalled();
  });

  it("returns QUOTE_NOT_FOUND when the quote does not belong to the job", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    (prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );
    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "5678",
        quoteId: "other-quote",
        decision: "approve",
      },
      notifyCtx
    );
    expect(result).toEqual({ error: "QUOTE_NOT_FOUND", jobExists: true });
  });

  it("approves a SENT quote and notifies the job creator", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    const findFirst = prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>;
    findFirst
      .mockResolvedValueOnce(sentQuote)
      .mockResolvedValueOnce({ ...sentQuote, status: "APPROVED" });
    (prisma.jobQuote.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });

    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "5678",
        quoteId: "quote-1",
        decision: "approve",
      },
      notifyCtx
    );

    expect(result.error).toBeUndefined();
    expect(result.quote?.status).toBe("APPROVED");
    expect(prisma.jobQuote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "quote-1", status: "SENT" },
      })
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: "QUOTE_RESPONDED",
        jobId: "job-1",
        toValue: "APPROVED",
      })
    );
    expect(mockNotify).toHaveBeenCalledWith(
      notifyCtx,
      expect.objectContaining({
        eventName: "quote_approved",
        recipients: { userIds: ["user-1"] },
      })
    );
  });

  it("rejects a SENT quote with a response note", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    const findFirst = prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>;
    findFirst.mockResolvedValueOnce(sentQuote).mockResolvedValueOnce({
      ...sentQuote,
      status: "REJECTED",
      responseNote: "too expensive",
    });
    (prisma.jobQuote.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });

    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "5678",
        quoteId: "quote-1",
        decision: "reject",
        note: "too expensive",
      },
      notifyCtx
    );

    expect(result.error).toBeUndefined();
    expect(result.quote?.status).toBe("REJECTED");
    expect(prisma.jobQuote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REJECTED",
          responseNote: "too expensive",
        }),
      })
    );
    expect(mockNotify).toHaveBeenCalledWith(
      notifyCtx,
      expect.objectContaining({ eventName: "quote_rejected" })
    );
  });

  it("rejects a repeated response (idempotency)", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    (prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sentQuote,
      status: "APPROVED",
      respondedAt: new Date(),
    });

    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "5678",
        quoteId: "quote-1",
        decision: "reject",
      },
      notifyCtx
    );

    expect(result).toEqual({
      error: "QUOTE_ALREADY_RESPONDED",
      jobExists: true,
    });
    expect(prisma.jobQuote.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale (superseded) quote", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    (prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...sentQuote,
      status: "SUPERSEDED",
    });

    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "5678",
        quoteId: "quote-1",
        decision: "approve",
      },
      notifyCtx
    );

    expect(result).toEqual({ error: "QUOTE_SUPERSEDED", jobExists: true });
    expect(prisma.jobQuote.updateMany).not.toHaveBeenCalled();
  });

  it("reports ALREADY_RESPONDED when a concurrent response wins the race", async () => {
    (prisma.job.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseJob
    );
    const findFirst = prisma.jobQuote.findFirst as ReturnType<typeof vi.fn>;
    findFirst
      .mockResolvedValueOnce(sentQuote)
      .mockResolvedValueOnce({ ...sentQuote, status: "APPROVED" });
    (prisma.jobQuote.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    const result = await respondToQuote(
      prisma,
      {
        code: "JOB-2026-0001",
        phone4: "5678",
        quoteId: "quote-1",
        decision: "reject",
      },
      notifyCtx
    );

    expect(result).toEqual({
      error: "QUOTE_ALREADY_RESPONDED",
      jobExists: true,
    });
  });
});
