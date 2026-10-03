import { isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetTzCache } from "../middlewares/dashboard-scope.js";
import { dashboardRoutes } from "../routes/dashboard.js";

const svc = vi.hoisted(() => ({
  activeRepairsQueue: vi.fn().mockResolvedValue([]),
  activeJobsCount: vi.fn().mockResolvedValue(1),
  avgRepairTimeHours: vi.fn().mockResolvedValue(0),
  avgRepairTimeHoursShop: vi.fn().mockResolvedValue(0),
  completedTodayCount: vi.fn().mockResolvedValue(0),
  financialTrend: vi.fn().mockResolvedValue([]),
  overdueJobs: vi.fn().mockResolvedValue([]),
  partsAlertsForTech: vi.fn().mockResolvedValue([]),
  pickupReady: vi.fn().mockResolvedValue([]),
  pipelineCounts: vi.fn().mockResolvedValue({
    CANCELLED: 0,
    DELIVERED: 0,
    DONE: 0,
    IN_REPAIR: 0,
    INTAKE: 1,
    ON_HOLD: 0,
    RETURNED: 0,
    WAITING_FOR_PARTS: 0,
  }),
  priorityActionsForTech: vi.fn().mockResolvedValue({
    jobsNeedingStatusUpdate: 0,
    overdueCount: 0,
    partsWaitingCount: 0,
  }),
  priorityAlerts: vi.fn().mockResolvedValue([]),
  recentActivityForTech: vi.fn().mockResolvedValue([]),
  revenueAndMarginComparison: vi.fn().mockResolvedValue({
    avgProfitMarginChange: 0,
    avgProfitMarginPrev: 0,
    avgProfitMarginThis: 0,
    revenueChangePct: 0,
    revenuePrevMonth: 0,
    revenueThisMonth: 0,
  }),
  todayOverview: vi.fn().mockResolvedValue({
    completedToday: 0,
    recentIntakes: [],
    totalToday: 0,
  }),
  todayScheduleForTech: vi.fn().mockResolvedValue([]),
  warrantyReturnsOpen: vi.fn().mockResolvedValue([]),
  waitingForPartsCount: vi.fn().mockResolvedValue(0),
  getKanbanJobsForTech: vi.fn().mockResolvedValue({ poolJobs: [], myJobs: [] }),
}));

const auth = vi.hoisted(() => ({
  api: {
    userHasPermission: vi
      .fn()
      .mockImplementation(
        ({
          body,
        }: {
          body: { role: string; permissions: Record<string, string[]> };
        }) => {
          const permissionMap: Record<string, Record<string, string[]>> = {
            OWNER: {
              dashboard: ["viewOwner", "viewTechnician", "viewFrontDesk"],
              reports: ["viewSelf", "viewShop", "viewMargin"],
              parts: ["viewCost"],
              jobs: ["view"],
            },
            TECHNICIAN: {
              dashboard: ["viewTechnician"],
              reports: ["viewSelf"],
              parts: ["viewCost"],
              jobs: ["view"],
            },
            FRONT_DESK: {
              dashboard: ["viewFrontDesk"],
              jobs: ["view"],
            },
          };
          const rolePerms = permissionMap[body.role];
          if (!rolePerms) {
            return Promise.resolve({ success: false });
          }
          for (const [resource, actions] of Object.entries(body.permissions)) {
            const allowed = rolePerms[resource];
            if (!allowed) {
              return Promise.resolve({ success: false });
            }
            if (!actions.every((a: string) => allowed.includes(a))) {
              return Promise.resolve({ success: false });
            }
          }
          return Promise.resolve({ success: true });
        }
      ),
  },
}));

vi.mock("../services/dashboard.service.js", () => svc);
vi.mock("../lib/auth.js", () => ({ createAuth: () => auth }));

function buildApp(user: { id: string; role: string } | null) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      reply.status(error.status).send({
        code: error.code,
        message: error.message,
      });
    } else {
      reply.status(500).send({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  });
  app.decorate("prisma", {
    job: { count: vi.fn().mockResolvedValue(0) },
    shopSettings: {
      findFirst: vi.fn().mockResolvedValue({ timezone: "UTC" }),
      findUnique: vi.fn().mockResolvedValue({ monthlyRevenueGoal: 1000 }),
    },
  } as never);
  app.decorate("auth", auth as never);
  app.addHook("onRequest", (req, _r, done) => {
    (req as { user: unknown }).user = user;
    done();
  });
  app.register(dashboardRoutes, { prefix: "/api/dashboard" });
  return app;
}

beforeEach(() => {
  __resetTzCache();
  vi.clearAllMocks();
});

describe("GET /api/dashboard/owner", () => {
  it("401 when no session", async () => {
    const res = await buildApp(null).inject({
      method: "GET",
      url: "/api/dashboard/owner",
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 when role is TECHNICIAN", async () => {
    const res = await buildApp({ id: "u", role: "TECHNICIAN" }).inject({
      method: "GET",
      url: "/api/dashboard/owner",
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 with full payload when role is OWNER", async () => {
    const res = await buildApp({ id: "u", role: "OWNER" }).inject({
      method: "GET",
      url: "/api/dashboard/owner",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("pipeline");
    expect(body).toHaveProperty("activeJobs");
    expect(body).toHaveProperty("completedToday");
    expect(body).toHaveProperty("revenueThisMonth");
    expect(body).toHaveProperty("avgProfitMargin");
    expect(body).toHaveProperty("financialTrend");
    expect(body).toHaveProperty("overdueJobs");
    expect(body).toHaveProperty("warrantyReturns");
    expect(body.monthlyRevenueGoal).toBe(1000);
  });
});

describe("GET /api/dashboard/technician", () => {
  it("403 for FRONT_DESK", async () => {
    const res = await buildApp({ id: "u", role: "FRONT_DESK" }).inject({
      method: "GET",
      url: "/api/dashboard/technician",
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for TECHNICIAN", async () => {
    const res = await buildApp({ id: "t", role: "TECHNICIAN" }).inject({
      method: "GET",
      url: "/api/dashboard/technician",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("pipeline");
    expect(body).toHaveProperty("myActiveJobs");
    expect(body).toHaveProperty("waitingForParts");
    expect(body).toHaveProperty("todaySchedule");
    expect(body).toHaveProperty("recentActivity");
    expect(body).toHaveProperty("priorityActions");
  });

  it("200 for OWNER (self-preview)", async () => {
    const res = await buildApp({ id: "o", role: "OWNER" }).inject({
      method: "GET",
      url: "/api/dashboard/technician",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/dashboard/front-desk", () => {
  it("403 for TECHNICIAN", async () => {
    const res = await buildApp({ id: "t", role: "TECHNICIAN" }).inject({
      method: "GET",
      url: "/api/dashboard/front-desk",
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 for FRONT_DESK", async () => {
    const res = await buildApp({ id: "f", role: "FRONT_DESK" }).inject({
      method: "GET",
      url: "/api/dashboard/front-desk",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("activeRepairs");
    expect(body).toHaveProperty("todayOverview");
    expect(body).toHaveProperty("priorityAlerts");
    expect(body).toHaveProperty("pickupReady");
  });

  it("200 for OWNER (self-preview)", async () => {
    const res = await buildApp({ id: "o", role: "OWNER" }).inject({
      method: "GET",
      url: "/api/dashboard/front-desk",
    });
    expect(res.statusCode).toBe(200);
  });
});
