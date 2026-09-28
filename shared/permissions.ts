import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

// ---------------------------------------------------------------------------
// Statement — single source of truth for every resource × action pair.
//
// The `user` and `session` keys are required by Better Auth's admin plugin.
// We spread them from `defaultStatements` to stay in sync with the library.
// ---------------------------------------------------------------------------

export const statement = {
  // Admin-plugin resources (keep in sync with better-auth internals)
  ...defaultStatements,

  // Business resources
  jobs: [
    "view",
    "create",
    "edit",
    "delete",
    "cancel",
    "assign",
    "selfAssign",
    "viewMargin",
  ] as const,

  jobStatus: [
    "INTAKE",
    "WAITING_FOR_PARTS",
    "IN_REPAIR",
    "ON_HOLD",
    "DONE",
    "DELIVERED",
    "RETURNED",
    "CANCELLED",
  ] as const,

  parts: [
    "viewCatalog",
    "manageCatalog",
    "add",
    "remove",
    "viewCost",
    "setCost",
    "overridePrice",
  ] as const,

  customers: ["view", "create", "edit"] as const,

  payments: ["view", "create", "delete"] as const,

  repairs: ["viewCatalog", "manageCatalog"] as const,

  reports: ["viewSelf", "viewShop", "viewMargin"] as const,

  settings: ["view", "edit"] as const,

  notifications: ["read", "send", "manage"] as const,

  ai: ["access"] as const,

  dashboard: ["viewOwner", "viewTechnician", "viewFrontDesk"] as const,

  returns: [
    "create",
    "edit",
    "triage",
    "resolveRework",
    "resolveRefund",
    "viewSelf",
    "viewShop",
  ] as const,
} as const;

// ---------------------------------------------------------------------------
// Access control instance
// ---------------------------------------------------------------------------

export const ac = createAccessControl(statement);

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

export const ownerRole = ac.newRole({
  // Admin-plugin resources — spread adminAc.statements then override user with
  // defaultStatements.user to capture all 10 actions including "impersonate-admins"
  ...adminAc.statements,
  user: defaultStatements.user,

  // Business resources
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

  payments: ["view", "create", "delete"],
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
});

export const technicianRole = ac.newRole({
  // Admin-plugin resources — limited access
  user: ["list", "get"],
  // No session access

  // Business resources
  jobs: ["view", "create", "edit", "selfAssign", "viewMargin"],
  jobStatus: ["WAITING_FOR_PARTS", "IN_REPAIR", "ON_HOLD", "DONE", "CANCELLED"],
  parts: [
    "viewCatalog",
    "add",
    "remove",
    "viewCost",
    "setCost",
    "overridePrice",
  ],
  customers: ["view", "create"],
  payments: ["view"],
  repairs: ["viewCatalog", "manageCatalog"],
  reports: ["viewSelf"],
  notifications: ["read"],
  // No settings
  ai: ["access"],
  dashboard: ["viewTechnician"],
  returns: ["create", "edit", "triage", "resolveRework", "viewSelf"],
});

export const frontDeskRole = ac.newRole({
  // Admin-plugin resources — limited access
  user: ["create", "list", "get", "update"],
  // No session access

  // Business resources
  jobs: ["view", "create", "edit", "cancel"],
  jobStatus: ["DELIVERED", "RETURNED", "CANCELLED"],
  // No parts
  customers: ["view", "create", "edit"],
  payments: ["view", "create", "delete"],
  // No repairs
  // No reports
  // No settings
  notifications: ["read", "send"],
  // No ai
  dashboard: ["viewFrontDesk"],
  returns: ["create", "edit", "viewSelf"],
});

// ---------------------------------------------------------------------------
// Convenience map (used when Better Auth reads the role string from the DB)
// ---------------------------------------------------------------------------

export const roles = {
  OWNER: ownerRole,
  TECHNICIAN: technicianRole,
  FRONT_DESK: frontDeskRole,
} as const;

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

export type Statement = typeof statement;
type NonEmptyArray<T> = [T, ...T[]];
export type PermissionCheck = {
  [K in keyof Statement]?: NonEmptyArray<Statement[K][number]>;
};
