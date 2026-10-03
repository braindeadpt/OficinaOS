import type { FastifyPluginAsync } from "fastify";
import { dashboardScope } from "../middlewares/dashboard-scope.js";
import { requirePermission } from "../middlewares/rbac.js";
import {
  activeJobsCount,
  activeRepairsQueue,
  avgRepairTimeHours,
  avgRepairTimeHoursShop,
  completedTodayCount,
  financialTrend,
  getKanbanJobsForTech,
  overdueJobs,
  partsAlertsForTech,
  pickupReady,
  pipelineCounts,
  priorityActionsForTech,
  priorityAlerts,
  recentActivityForTech,
  revenueAndMarginComparison,
  todayOverview,
  todayScheduleForTech,
  waitingForPartsCount,
  warrantyReturnsOpen,
} from "../services/dashboard.service.js";
import { monthRange, prevMonthRange, todayRange } from "../utils/time-range.js";

// biome-ignore lint/suspicious/useAwait: FastifyPluginAsync requires async
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/owner",
    {
      preHandler: [
        requirePermission({ dashboard: ["viewOwner"] }),
        dashboardScope,
      ],
      schema: { tags: ["dashboard"], summary: "Owner dashboard" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const now = new Date();
      const today = todayRange(scope.shopTz, now);
      const month = monthRange(scope.shopTz, now);
      const prevMonth = prevMonthRange(scope.shopTz, now);
      const [
        pipeline,
        activeJobs,
        completedToday,
        comparison,
        trend,
        overdue,
        warranty,
        ready,
        shopSettings,
      ] = await Promise.all([
        pipelineCounts(app.prisma, scope),
        activeJobsCount(app.prisma, scope),
        completedTodayCount(app.prisma, scope, today),
        revenueAndMarginComparison(app.prisma, scope, month, prevMonth),
        financialTrend(app.prisma, scope, 7),
        overdueJobs(app.prisma, scope, 10),
        warrantyReturnsOpen(app.prisma, scope, 5),
        pickupReady(app.prisma, scope, 10),
        app.prisma.shopSettings.findUnique({
          where: { id: "default" },
          select: { monthlyRevenueGoal: true },
        }),
      ]);
      return {
        pipeline,
        activeJobs,
        completedToday,
        revenueThisMonth: comparison.revenueThisMonth,
        revenuePrevMonth: comparison.revenuePrevMonth,
        revenueChangePct: comparison.revenueChangePct,
        avgProfitMargin: comparison.avgProfitMarginThis,
        avgProfitMarginPrev: comparison.avgProfitMarginPrev,
        avgProfitMarginChange: comparison.avgProfitMarginChange,
        financialTrend: trend,
        monthlyRevenueGoal:
          shopSettings?.monthlyRevenueGoal === null ||
          shopSettings?.monthlyRevenueGoal === undefined
            ? null
            : Number(shopSettings.monthlyRevenueGoal),
        overdueJobs: overdue,
        pickupReady: ready,
        warrantyReturns: warranty,
      };
    }
  );

  app.get(
    "/technician",
    {
      preHandler: [
        requirePermission({ dashboard: ["viewTechnician"] }),
        dashboardScope,
      ],
      schema: { tags: ["dashboard"], summary: "Technician dashboard" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const techScope = { ...scope, role: "TECHNICIAN" as const };
      const now = new Date();
      const today = todayRange(scope.shopTz, now);
      const [
        pipeline,
        waitingForParts,
        completedToday,
        todaySchedule,
        recentActivity,
        repairTime,
        priorityActions,
        partsAlerts,
        kanbanJobs,
      ] = await Promise.all([
        pipelineCounts(app.prisma, techScope),
        waitingForPartsCount(app.prisma, scope.userId),
        completedTodayCount(app.prisma, techScope, today),
        todayScheduleForTech(app.prisma, scope.userId, today),
        recentActivityForTech(app.prisma, scope.userId, 20),
        avgRepairTimeHours(app.prisma, scope.userId, 30),
        priorityActionsForTech(app.prisma, scope.userId),
        partsAlertsForTech(app.prisma, 10, scope.userId),
        getKanbanJobsForTech(app.prisma, scope.userId),
      ]);
      const myActiveJobs =
        pipeline.INTAKE +
        pipeline.IN_REPAIR +
        pipeline.ON_HOLD +
        pipeline.WAITING_FOR_PARTS;
      return {
        pipeline,
        myActiveJobs,
        completedToday,
        waitingForParts,
        avgRepairTimeHours: repairTime,
        todaySchedule,
        recentActivity,
        priorityActions,
        partsAlerts,
        poolJobs: kanbanJobs.poolJobs,
        myJobs: kanbanJobs.myJobs,
      };
    }
  );

  app.get(
    "/front-desk",
    {
      preHandler: [
        requirePermission({ dashboard: ["viewFrontDesk"] }),
        dashboardScope,
      ],
      schema: { tags: ["dashboard"], summary: "Front desk dashboard" },
    },
    async (req) => {
      // biome-ignore lint/style/noNonNullAssertion: set by dashboardScope preHandler
      const scope = req.dashboardScope!;
      const now = new Date();
      const today = todayRange(scope.shopTz, now);
      const [activeRepairs, overview, alerts, ready, repairTime] =
        await Promise.all([
          activeRepairsQueue(app.prisma, scope, today, 20),
          todayOverview(app.prisma, scope, today),
          priorityAlerts(app.prisma, scope, 5),
          pickupReady(app.prisma, scope, 10),
          avgRepairTimeHoursShop(app.prisma, scope, 30),
        ]);
      return {
        activeRepairs,
        avgRepairTimeHours: repairTime,
        todayOverview: overview,
        priorityAlerts: alerts,
        pickupReady: ready,
      };
    }
  );
};
