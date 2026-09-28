import { Role, type RoleType } from "@shared/constants/roles";
import { AppError, isAppError } from "@shared/errors/app-error.js";
import Fastify from "fastify";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { customersRoutes } from "../routes/customers.js";
import { jobRoutes } from "../routes/jobs.js";
import { notificationsRoutes } from "../routes/notifications.js";
import { partsRoutes } from "../routes/parts.js";
import { receiptRoutes } from "../routes/receipts.js";
import { repairCatalogRoutes } from "../routes/repairs.js";
import { returnClaimsRoutes } from "../routes/return-claims.js";
import { settingsRoutes } from "../routes/settings.js";
import { usersRoutes } from "../routes/users.js";

/**
 * RBAC Matrix Test
 *
 * Tests permission enforcement across roles.
 * Validates that the RBAC middleware correctly:
 * 1. Returns 401 for unauthenticated requests
 * 2. Returns 403 for authenticated but unauthorized requests
 * 3. Allows access when user has required permissions
 */

// Simple mock factory - we only need to verify auth, not service logic
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  userHasPermission: vi.fn(),
}));

vi.mock("better-auth/node", () => ({
  fromNodeHeaders: vi.fn().mockReturnValue(new Headers()),
}));

// Mock all services to return success (we're testing auth, not services)
vi.mock("../services/job.service.js", () => ({
  list: vi.fn().mockResolvedValue({ jobs: [], nextCursor: null }),
  getMetrics: vi.fn().mockResolvedValue({ total: 0 }),
  create: vi.fn().mockResolvedValue({ id: "job-1" }),
  getById: vi.fn().mockResolvedValue({
    id: "job-1",
    status: "IN_REPAIR",
    partsUsed: [],
    repairs: [],
  }),
  update: vi.fn().mockResolvedValue({ id: "job-1" }),
  transitionStatus: vi.fn().mockResolvedValue({ id: "job-1" }),
  lookupByCode: vi.fn().mockResolvedValue(null),
  computeMargin: vi.fn(),
  computeFinalCost: vi.fn(),
}));

vi.mock("../services/job-notes.service.js", () => ({
  list: vi.fn().mockResolvedValue([]),
  add: vi.fn().mockResolvedValue({ id: "note-1" }),
}));

vi.mock("../services/job-parts.service.js", () => ({
  add: vi.fn().mockResolvedValue({ id: "part-1" }),
  remove: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/job-repairs.service.js", () => ({
  add: vi.fn().mockResolvedValue({ id: "repair-1" }),
  remove: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/job-photos.service.js", () => ({
  upload: vi.fn().mockResolvedValue({ id: "photo-1" }),
  remove: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/job-waiting-parts.service.js", () => ({
  add: vi.fn().mockResolvedValue({ id: "wp-1" }),
  remove: vi.fn().mockResolvedValue(true),
}));

vi.mock("../services/customers.service.js", () => ({
  list: vi.fn().mockResolvedValue({ customers: [], nextCursor: null }),
  create: vi.fn().mockResolvedValue({ id: "cust-1" }),
  search: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue({ id: "cust-1" }),
}));

vi.mock("../services/parts-catalog.service.js", () => ({
  list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  create: vi.fn().mockResolvedValue({ id: "part-1" }),
  getById: vi.fn().mockResolvedValue({ id: "part-1" }),
  update: vi.fn().mockResolvedValue({ id: "part-1" }),
  toggleActive: vi.fn().mockResolvedValue({ id: "part-1" }),
}));

vi.mock("../services/repair-catalog.service.js", () => ({
  list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
  create: vi.fn().mockResolvedValue({ id: "repair-1" }),
  getById: vi.fn().mockResolvedValue({ id: "repair-1" }),
  update: vi.fn().mockResolvedValue({ id: "repair-1" }),
  toggleActive: vi.fn().mockResolvedValue({ id: "repair-1" }),
}));

vi.mock("../services/settings.service.js", () => ({
  getAiSettings: vi.fn().mockResolvedValue({}),
  getShopSettings: vi.fn().mockResolvedValue({}),
  getNotificationTemplates: vi.fn().mockResolvedValue([]),
  upsertAiSettings: vi.fn().mockResolvedValue({}),
  upsertShopSettings: vi.fn().mockResolvedValue({}),
  updateNotificationTemplate: vi.fn().mockResolvedValue({}),
  testAiConnection: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../services/receipt.service.js", () => ({
  generateReceiptHtml: vi.fn().mockReturnValue("<html></html>"),
}));

vi.mock("../services/avatar.service.js", () => ({
  uploadAvatar: vi
    .fn()
    .mockResolvedValue({ avatarUrl: "http://test.com/avatar.png" }),
  deleteAvatar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/return-claim.service.js", () => ({
  create: vi.fn().mockResolvedValue({ id: "rc-1" }),
  getById: vi.fn().mockResolvedValue({ id: "rc-1", status: "OPEN" }),
  list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
  triage: vi.fn().mockResolvedValue({ id: "rc-1" }),
  spawnRework: vi
    .fn()
    .mockResolvedValue({ claimId: "rc-1", reworkJobId: "r-1" }),
  detachRework: vi.fn().mockResolvedValue({ id: "rc-1" }),
  resolve: vi.fn().mockResolvedValue({ id: "rc-1", status: "RESOLVED" }),
  uploadPhoto: vi.fn().mockResolvedValue({ id: "ph-1", path: "/x.jpg" }),
  removePhoto: vi.fn().mockResolvedValue({ removed: true }),
}));

// Real requirePermission that checks permissions against our defined roles
vi.mock("../middlewares/rbac.js", () => ({
  requirePermission:
    (permissions: Record<string, string[]>) => async (request: any) => {
      if (!request.user) {
        throw new AppError("UNAUTHORIZED");
      }
      const result = await request.server.auth.api.userHasPermission({
        body: {
          role: request.user.role,
          permissions,
        },
      });
      if (!result.success) {
        throw new AppError("FORBIDDEN");
      }
    },
}));

// Role permission definitions (from shared/permissions.ts)
const rolePermissions: Record<RoleType, Record<string, string[]>> = {
  OWNER: {
    jobs: [
      "view",
      "create",
      "edit",
      "delete",
      "cancel",
      "assign",
      "selfAssign",
      "viewMargin",
    ],
    jobStatus: [
      "INTAKE",
      "WAITING_FOR_PARTS",
      "IN_REPAIR",
      "ON_HOLD",
      "DONE",
      "DELIVERED",
      "RETURNED",
      "CANCELLED",
    ],
    parts: [
      "viewCatalog",
      "manageCatalog",
      "add",
      "remove",
      "viewCost",
      "setCost",
      "overridePrice",
    ],
    customers: ["view", "create", "edit"],
    repairs: ["viewCatalog", "manageCatalog"],
    reports: ["viewSelf", "viewShop", "viewMargin"],
    settings: ["view", "edit"],
    notifications: ["read", "send", "manage"],
    ai: ["access"],
    dashboard: ["viewOwner", "viewTechnician", "viewFrontDesk"],
    returns: [
      "create",
      "edit",
      "triage",
      "resolveRework",
      "resolveRefund",
      "viewSelf",
      "viewShop",
    ],
    user: [
      "list",
      "get",
      "create",
      "update",
      "delete",
      "change-role",
      "ban",
      "impersonate",
      "set-owner",
      "impersonate-admins",
    ],
    session: ["list", "get", "update", "delete", "revoke-all"],
  },
  TECHNICIAN: {
    jobs: ["view", "create", "edit", "selfAssign", "viewMargin"],
    jobStatus: [
      "WAITING_FOR_PARTS",
      "IN_REPAIR",
      "ON_HOLD",
      "DONE",
      "CANCELLED",
    ],
    parts: [
      "viewCatalog",
      "add",
      "remove",
      "viewCost",
      "setCost",
      "overridePrice",
    ],
    customers: ["view", "create"],
    repairs: ["viewCatalog", "manageCatalog"],
    reports: ["viewSelf"],
    notifications: ["read"],
    ai: ["access"],
    dashboard: ["viewTechnician"],
    returns: ["create", "edit", "triage", "resolveRework", "viewSelf"],
    user: ["list", "get"],
  },
  FRONT_DESK: {
    jobs: ["view", "create", "edit", "cancel"],
    jobStatus: ["DELIVERED", "RETURNED", "CANCELLED"],
    customers: ["view", "create", "edit"],
    notifications: ["read", "send"],
    dashboard: ["viewFrontDesk"],
    returns: ["create", "edit", "viewSelf"],
    user: ["create", "list", "get", "update"],
  },
};

function createMockUser(role: RoleType) {
  return {
    id: `user-${role.toLowerCase()}`,
    name: `Test ${role}`,
    username: `test-${role.toLowerCase()}`,
    email: `test-${role.toLowerCase()}@oficinaos.test`,
    role,
    isActive: true,
    mustChangePassword: false,
  };
}

function buildApp(userId: string | null, role: RoleType | null = null) {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const payload: Record<string, unknown> = {
        code: error.code,
        message: error instanceof Error ? error.message : "Internal error",
      };
      if (error.details !== undefined) {
        payload.details = error.details;
      }
      reply.status(error.status).send(payload);
      return;
    }
    reply.status(500).send({
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });

  const mockSession = userId
    ? {
        user: createMockUser(role || Role.OWNER),
        session: { id: "sess-1" },
      }
    : null;

  mocks.getSession.mockResolvedValue(mockSession);

  // Mock userHasPermission to actually check role permissions
  mocks.userHasPermission.mockImplementation(
    ({
      body,
    }: {
      body: { role: RoleType; permissions: Record<string, string[]> };
    }) => {
      const rolePerms = rolePermissions[body.role];
      if (!rolePerms) {
        return { success: false };
      }

      for (const [resource, actions] of Object.entries(body.permissions)) {
        const roleActions = rolePerms[resource];
        if (!roleActions) {
          return { success: false };
        }
        for (const action of actions) {
          if (!roleActions.includes(action)) {
            return { success: false };
          }
        }
      }
      return { success: true };
    }
  );

  (app.decorate as (name: string, value: unknown) => void)("auth", {
    api: {
      getSession: mocks.getSession,
      userHasPermission: mocks.userHasPermission,
    },
  });

  (app.decorate as (name: string, value: unknown) => void)("prisma", {
    $queryRaw: vi.fn(),
    auditLog: { findMany: vi.fn() },
    user: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: "user-1", name: "Test" }),
      count: vi.fn().mockResolvedValue(0),
    },
  });

  // Add user from session
  app.addHook("preHandler", async (request: any) => {
    const session = await app.auth.api.getSession({ headers: new Headers() });
    request.user = session?.user || null;
  });

  // Register all routes
  app.register(jobRoutes, { prefix: "/api/jobs" });
  app.register(customersRoutes, { prefix: "/api/customers" });
  app.register(partsRoutes, { prefix: "/api/parts" });
  app.register(repairCatalogRoutes, { prefix: "/api/repairs" });
  app.register(usersRoutes, { prefix: "/api/users" });
  app.register(settingsRoutes, { prefix: "/api/settings" });
  app.register(notificationsRoutes, { prefix: "/api/notifications" });
  app.register(receiptRoutes, { prefix: "/api/receipts" });
  app.register(returnClaimsRoutes, { prefix: "/api/return-claims" });

  return app;
}

describe("RBAC Matrix", () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  describe("Authentication Enforcement", () => {
    it("returns 401 for protected routes without authentication", async () => {
      const app = buildApp(null);
      const res = await app.inject({
        method: "GET",
        url: "/api/jobs",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("Job Routes", () => {
    describe("GET /api/jobs (list)", () => {
      it("OWNER can list jobs", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({ method: "GET", url: "/api/jobs" });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN can list jobs", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({ method: "GET", url: "/api/jobs" });
        expect(res.statusCode).toBe(200);
      });

      it("FRONT_DESK can list jobs", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({ method: "GET", url: "/api/jobs" });
        expect(res.statusCode).toBe(200);
      });
    });

    describe("POST /api/jobs (create)", () => {
      it("OWNER can create jobs", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: {
            customer: { name: "Test", phone: "1234567890" },
            device: {
              brand: { name: "Apple" },
              model: "iPhone",
              type: "PHONE",
            },
            problem: "Screen broken",
          },
        });
        // 400 for validation errors, not 403 for permission
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN can create jobs", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: {
            customer: { name: "Test", phone: "1234567890" },
            device: {
              brand: { name: "Apple" },
              model: "iPhone",
              type: "PHONE",
            },
            problem: "Screen broken",
          },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("FRONT_DESK can create jobs", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "POST",
          url: "/api/jobs",
          payload: {
            customer: { name: "Test", phone: "1234567890" },
            device: {
              brand: { name: "Apple" },
              model: "iPhone",
              type: "PHONE",
            },
            problem: "Screen broken",
          },
        });
        expect(res.statusCode).not.toBe(403);
      });
    });
  });

  describe("Parts Catalog Routes", () => {
    describe("GET /api/parts", () => {
      it("OWNER can view parts catalog", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({ method: "GET", url: "/api/parts" });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN can view parts catalog", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({ method: "GET", url: "/api/parts" });
        expect(res.statusCode).toBe(200);
      });

      it("FRONT_DESK cannot view parts catalog", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({ method: "GET", url: "/api/parts" });
        expect(res.statusCode).toBe(403);
      });
    });

    describe("POST /api/parts (create)", () => {
      it("OWNER can create parts", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "POST",
          url: "/api/parts",
          payload: { name: "Test Part", category: "SCREEN", unitPrice: 50 },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN cannot create parts (missing manageCatalog)", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "POST",
          url: "/api/parts",
          payload: { name: "Test Part", category: "SCREEN", unitPrice: 50 },
        });
        // TECHNICIAN has parts.add but not parts.manageCatalog
        expect(res.statusCode).toBe(403);
      });

      it("FRONT_DESK cannot create parts", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "POST",
          url: "/api/parts",
          payload: { name: "Test Part", category: "SCREEN", unitPrice: 50 },
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });

  describe("Repairs Catalog Routes", () => {
    describe("GET /api/repairs", () => {
      it("OWNER can view repairs catalog", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({ method: "GET", url: "/api/repairs" });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN can view repairs catalog", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({ method: "GET", url: "/api/repairs" });
        expect(res.statusCode).toBe(200);
      });

      it("FRONT_DESK cannot view repairs catalog", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({ method: "GET", url: "/api/repairs" });
        expect(res.statusCode).toBe(403);
      });
    });

    describe("POST /api/repairs (create)", () => {
      it("OWNER can create repairs", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "POST",
          url: "/api/repairs",
          payload: {
            name: "Screen Repair",
            category: "SCREEN_REPAIR",
            basePrice: 100,
          },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN can create repairs", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "POST",
          url: "/api/repairs",
          payload: {
            name: "Screen Repair",
            category: "SCREEN_REPAIR",
            basePrice: 100,
          },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("FRONT_DESK cannot create repairs", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "POST",
          url: "/api/repairs",
          payload: {
            name: "Screen Repair",
            category: "SCREEN_REPAIR",
            basePrice: 100,
          },
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });

  describe("Settings Routes", () => {
    describe("GET /api/settings", () => {
      it("OWNER can view settings", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({ method: "GET", url: "/api/settings" });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN cannot view settings", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({ method: "GET", url: "/api/settings" });
        expect(res.statusCode).toBe(403);
      });

      it("FRONT_DESK cannot view settings", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({ method: "GET", url: "/api/settings" });
        expect(res.statusCode).toBe(403);
      });
    });

    describe("PUT /api/settings/ai (edit)", () => {
      it("OWNER can update settings", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "PUT",
          url: "/api/settings/ai",
          payload: { provider: "openai" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN cannot update settings", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "PUT",
          url: "/api/settings/ai",
          payload: { provider: "openai" },
        });
        expect(res.statusCode).toBe(403);
      });

      it("FRONT_DESK cannot update settings", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "PUT",
          url: "/api/settings/ai",
          payload: { provider: "openai" },
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });

  describe("Customer Routes", () => {
    describe("GET /api/customers", () => {
      it("OWNER can list customers", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({ method: "GET", url: "/api/customers" });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN can list customers", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({ method: "GET", url: "/api/customers" });
        expect(res.statusCode).toBe(200);
      });

      it("FRONT_DESK can list customers", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({ method: "GET", url: "/api/customers" });
        expect(res.statusCode).toBe(200);
      });
    });

    describe("PATCH /api/customers/:id (edit)", () => {
      it("OWNER can edit customers", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/customers/cust-1",
          payload: { name: "Updated Name" },
        });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN cannot edit customers", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/customers/cust-1",
          payload: { name: "Updated Name" },
        });
        expect(res.statusCode).toBe(403);
      });

      it("FRONT_DESK can edit customers", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/customers/cust-1",
          payload: { name: "Updated Name" },
        });
        expect(res.statusCode).toBe(200);
      });
    });
  });

  describe("User Routes", () => {
    describe("GET /api/users (list)", () => {
      it("OWNER can list users", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({ method: "GET", url: "/api/users" });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN can list users", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({ method: "GET", url: "/api/users" });
        expect(res.statusCode).toBe(200);
      });

      it("FRONT_DESK can list users", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({ method: "GET", url: "/api/users" });
        expect(res.statusCode).toBe(200);
      });
    });
  });

  describe("Notification Routes", () => {
    describe("GET /api/notifications/templates", () => {
      it("OWNER can view notification templates", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "GET",
          url: "/api/notifications/templates",
        });
        expect(res.statusCode).toBe(200);
      });

      it("TECHNICIAN can view notification templates", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "GET",
          url: "/api/notifications/templates",
        });
        expect(res.statusCode).toBe(200);
      });

      it("FRONT_DESK can view notification templates (has notifications.read)", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "GET",
          url: "/api/notifications/templates",
        });
        // FRONT_DESK has notifications.read permission
        expect(res.statusCode).toBe(200);
      });
    });

    describe("PUT /api/notifications/templates/:id (manage)", () => {
      it("OWNER can manage notification templates", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "PUT",
          url: "/api/notifications/templates/template-1",
          payload: { body: "Updated template" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN cannot manage notification templates", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "PUT",
          url: "/api/notifications/templates/template-1",
          payload: { body: "Updated template" },
        });
        expect(res.statusCode).toBe(403);
      });

      it("FRONT_DESK cannot manage notification templates", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "PUT",
          url: "/api/notifications/templates/template-1",
          payload: { body: "Updated template" },
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });

  describe("Receipt Routes", () => {
    describe("GET /api/receipts/:id/receipt", () => {
      it("OWNER can print receipts", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "GET",
          url: "/api/receipts/job-1/receipt",
        });
        // May be 200 or 404 if job not found, but not 403
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN can print receipts", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "GET",
          url: "/api/receipts/job-1/receipt",
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("FRONT_DESK can print receipts", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "GET",
          url: "/api/receipts/job-1/receipt",
        });
        expect(res.statusCode).not.toBe(403);
      });
    });
  });

  describe("Return Claims Routes", () => {
    describe("POST /api/return-claims", () => {
      it("OWNER can create claims", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "POST",
          url: "/api/return-claims",
          payload: { originalJobId: "job-1", returnReason: "test" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("TECHNICIAN can create claims", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "POST",
          url: "/api/return-claims",
          payload: { originalJobId: "job-1", returnReason: "test" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("FRONT_DESK can create claims", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "POST",
          url: "/api/return-claims",
          payload: { originalJobId: "job-1", returnReason: "test" },
        });
        expect(res.statusCode).not.toBe(403);
      });
    });

    describe("PATCH /api/return-claims/:id/resolve", () => {
      it("allows TECHNICIAN to resolve REWORK_FREE", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/return-claims/rc-1/resolve",
          payload: { resolutionOutcome: "REWORK_FREE" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("blocks TECHNICIAN from resolving REFUND_FULL", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/return-claims/rc-1/resolve",
          payload: { resolutionOutcome: "REFUND_FULL", refundAmount: 100 },
        });
        expect(res.statusCode).toBe(403);
      });

      it("allows OWNER to resolve REFUND_FULL", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/return-claims/rc-1/resolve",
          payload: { resolutionOutcome: "REFUND_FULL", refundAmount: 100 },
        });
        expect(res.statusCode).not.toBe(403);
      });
    });

    describe("PATCH /api/return-claims/:id/triage", () => {
      it("allows OWNER to triage claims", async () => {
        const app = buildApp("user-1", Role.OWNER);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/return-claims/rc-1/triage",
          payload: { faultCategory: "WORKMANSHIP" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("allows TECHNICIAN to triage claims", async () => {
        const app = buildApp("user-1", Role.TECHNICIAN);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/return-claims/rc-1/triage",
          payload: { faultCategory: "WORKMANSHIP" },
        });
        expect(res.statusCode).not.toBe(403);
      });

      it("blocks FRONT_DESK from triaging claims", async () => {
        const app = buildApp("user-1", Role.FRONT_DESK);
        const res = await app.inject({
          method: "PATCH",
          url: "/api/return-claims/rc-1/triage",
          payload: { faultCategory: "WORKMANSHIP" },
        });
        expect(res.statusCode).toBe(403);
      });
    });
  });
});
