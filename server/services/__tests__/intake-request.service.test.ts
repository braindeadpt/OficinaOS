import type { PrismaClient } from "@generated/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertIntakeRequest,
  dismissIntakeRequest,
  listIntakeRequests,
  submitPreCheckRequest,
} from "../intake-request.service";

const notifyMock = vi.fn().mockResolvedValue(undefined);
const findManyUsersMock = vi.fn().mockResolvedValue([{ id: "u-1" }]);

vi.mock("../notification-dispatch.js", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock("../../repositories/notification.repository.js", () => ({
  findManyUsers: (...args: unknown[]) => findManyUsersMock(...args),
}));

function mockPrisma(
  overrides: Partial<Record<keyof PrismaClient, unknown>> = {}
) {
  const mock = {
    customer: {
      update: vi.fn().mockResolvedValue({}),
      ...((overrides as Record<string, unknown>).customer || {}),
    },
    intakeRequest: {
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      update: vi.fn(),
      ...((overrides as Record<string, unknown>).intakeRequest || {}),
    },
    job: {
      findUnique: vi.fn(),
      ...((overrides as Record<string, unknown>).job || {}),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ lastSeq: 7 }]),
    ...overrides,
  };
  return mock as unknown as PrismaClient;
}

const PRE_CODE_RE = /^PRE-\d{4}-\d{6}$/;

const INPUT = {
  company: "",
  customerName: "Maria Silva",
  customerPhone: "912345678",
  deviceLabel: "iPhone 14",
  problem: "Screen cracked after a fall, touch still works.",
  whatsappOptIn: false,
};

const NOTIFY_CTX = { prisma: {} as PrismaClient };

describe("submitPreCheckRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyUsersMock.mockResolvedValue([{ id: "u-1" }]);
  });

  it("creates the request with a PRE- code and notifies staff", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.create).mockResolvedValue({
      id: "req-1",
      code: `PRE-${new Date().getFullYear()}-000007`,
    } as never);

    const result = await submitPreCheckRequest(prisma, INPUT, NOTIFY_CTX);

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.intakeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: `PRE-${new Date().getFullYear()}-000007`,
        customerEmail: null,
        customerName: "Maria Silva",
        customerPhone: "912345678",
        deviceLabel: "iPhone 14",
        problem: INPUT.problem,
        whatsappOptIn: false,
      }),
    });
    expect(result.code).toMatch(PRE_CODE_RE);

    await vi.waitFor(() => {
      expect(notifyMock).toHaveBeenCalled();
    });
    expect(findManyUsersMock).toHaveBeenCalledWith(
      prisma,
      { isActive: true, role: { in: ["OWNER", "FRONT_DESK"] } },
      { id: true }
    );
    expect(notifyMock).toHaveBeenCalledWith(
      NOTIFY_CTX,
      expect.objectContaining({
        eventName: "pre_check_submitted",
        recipients: { userIds: ["u-1"] },
      })
    );
  });

  it("persists the requested appointment as scheduledFor", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.create).mockResolvedValue({
      id: "req-1",
      code: "PRE-2026-000007",
    } as never);
    const scheduledFor = "2026-10-15T10:30:00.000Z";

    await submitPreCheckRequest(prisma, { ...INPUT, scheduledFor }, NOTIFY_CTX);

    expect(prisma.intakeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduledFor: new Date(scheduledFor),
      }),
    });
  });

  it("stores null scheduledFor when the customer did not pick a time", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.create).mockResolvedValue({
      id: "req-1",
      code: "PRE-2026-000007",
    } as never);

    await submitPreCheckRequest(prisma, INPUT, NOTIFY_CTX);

    expect(prisma.intakeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scheduledFor: null }),
    });
  });

  it("skips notify when no staff user exists", async () => {
    findManyUsersMock.mockResolvedValue([]);
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.create).mockResolvedValue({
      id: "req-1",
      code: "PRE-2026-000007",
    } as never);

    await submitPreCheckRequest(prisma, INPUT, NOTIFY_CTX);
    await new Promise((r) => setTimeout(r, 10));

    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe("listIntakeRequests", () => {
  it("filters by status when provided", async () => {
    const prisma = mockPrisma();
    await listIntakeRequests(prisma, "PENDING");
    expect(prisma.intakeRequest.findMany).toHaveBeenCalledWith({
      include: { job: { select: { jobCode: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      where: { status: "PENDING" },
    });
  });

  it("lists all when no status is given", async () => {
    const prisma = mockPrisma();
    await listIntakeRequests(prisma);
    expect(prisma.intakeRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });
});

describe("dismissIntakeRequest", () => {
  it("rejects an unknown request", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue(null);
    await expect(dismissIntakeRequest(prisma, "req-x")).rejects.toMatchObject({
      code: "INTAKE_REQUEST_NOT_FOUND",
    });
  });

  it("rejects dismissing a non-pending request", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue({
      id: "req-1",
      status: "CONVERTED",
    } as never);
    await expect(dismissIntakeRequest(prisma, "req-1")).rejects.toMatchObject({
      code: "INTAKE_REQUEST_NOT_PENDING",
    });
  });

  it("dismisses a pending request", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue({
      id: "req-1",
      status: "PENDING",
    } as never);
    await dismissIntakeRequest(prisma, "req-1");
    expect(prisma.intakeRequest.update).toHaveBeenCalledWith({
      data: { status: "DISMISSED" },
      where: { id: "req-1" },
    });
  });
});

describe("convertIntakeRequest", () => {
  const pending = { id: "req-1", status: "PENDING", whatsappOptIn: false };

  it("rejects an unknown request", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue(null);
    await expect(
      convertIntakeRequest(prisma, "req-x", "job-1")
    ).rejects.toMatchObject({ code: "INTAKE_REQUEST_NOT_FOUND" });
  });

  it("rejects converting a request that is not pending", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue({
      ...pending,
      status: "DISMISSED",
    } as never);
    await expect(
      convertIntakeRequest(prisma, "req-1", "job-1")
    ).rejects.toMatchObject({ code: "INTAKE_REQUEST_NOT_PENDING" });
  });

  it("rejects a missing job", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue(
      pending as never
    );
    vi.mocked(prisma.job.findUnique).mockResolvedValue(null);
    await expect(
      convertIntakeRequest(prisma, "req-1", "job-x")
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
  });

  it("marks the request converted and links the job", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue(
      pending as never
    );
    vi.mocked(prisma.job.findUnique).mockResolvedValue({
      id: "job-1",
      customerId: "cust-1",
    } as never);

    await convertIntakeRequest(prisma, "req-1", "job-1");

    expect(prisma.intakeRequest.update).toHaveBeenCalledWith({
      data: {
        job: { connect: { id: "job-1" } },
        status: "CONVERTED",
      },
      where: { id: "req-1" },
    });
    expect(prisma.customer.update).not.toHaveBeenCalled();
  });

  it("applies the public WhatsApp opt-in to the job customer", async () => {
    const prisma = mockPrisma();
    vi.mocked(prisma.intakeRequest.findUnique).mockResolvedValue({
      ...pending,
      whatsappOptIn: true,
    } as never);
    vi.mocked(prisma.job.findUnique).mockResolvedValue({
      id: "job-1",
      customerId: "cust-1",
    } as never);

    await convertIntakeRequest(prisma, "req-1", "job-1");

    expect(prisma.customer.update).toHaveBeenCalledWith({
      data: {
        whatsappConsent: true,
        whatsappConsentAt: expect.any(Date),
      },
      where: { id: "cust-1" },
    });
  });
});
