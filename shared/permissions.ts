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

  sales: ["view", "create"] as const,

  repairs: ["viewCatalog", "manageCatalog"] as const,

  reports: ["viewSelf", "viewShop", "viewMargin"] as const,

  settings: ["view", "edit"] as const,

  notifications: ["read", "send", "manage"] as const,

  // Caixa de entrada de mensagens de clientes (módulo Pro "ai-inbox"):
  // view = ler conversas/mensagens/cliente; send = responder, rascunhos,
  // marcar estado/lida; manage = atribuir conversas a utilizadores.
  inbox: ["view", "send", "manage"] as const,

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

  tradeins: ["view", "create", "edit", "cancel"] as const,

  // Shop loaner fleet — "return" records a unit physically coming back.
  loaners: ["view", "manage", "return"] as const,
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

  sales: ["view", "create"],
  repairs: ["viewCatalog", "manageCatalog"],
  reports: ["viewSelf", "viewShop", "viewMargin"],
  settings: ["view", "edit"],
  notifications: ["read", "send", "manage"],
  inbox: ["view", "send", "manage"],
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
  tradeins: ["view", "create", "edit", "cancel"],
  loaners: ["view", "manage", "return"],
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
  sales: ["view", "create"],
  repairs: ["viewCatalog", "manageCatalog"],
  reports: ["viewSelf"],
  notifications: ["read", "send"],
  inbox: ["view", "send"],
  // No settings
  // No ai — the analyst reads job_notes (free text with customer contacts);
  // exposing it to every technician profile widened PII access beyond what
  // the bench needs. OWNER-only by product decision (2026-11).
  dashboard: ["viewTechnician"],
  returns: ["create", "edit", "triage", "resolveRework", "viewSelf"],
  // Trade-ins involve money — technicians can see them but not transact.
  tradeins: ["view"],
  // Technicians assign units at intake and receive them back at the bench.
  loaners: ["view", "return"],
});

export const frontDeskRole = ac.newRole({
  // Admin-plugin resources — limited access.
  // No create/update: staff account management is OWNER-only so front-desk
  // users cannot mint or tamper with privileged accounts.
  user: ["list", "get"],
  // No session access

  // Business resources
  jobs: ["view", "create", "edit", "cancel"],
  jobStatus: ["DELIVERED", "RETURNED", "CANCELLED"],
  // No parts
  customers: ["view", "create", "edit"],
  payments: ["view", "create", "delete"],
  sales: ["view", "create"],
  // No repairs
  // No reports
  // No settings
  notifications: ["read", "send"],
  inbox: ["view", "send", "manage"],
  // No ai
  dashboard: ["viewFrontDesk"],
  returns: ["create", "edit", "viewSelf"],
  tradeins: ["view", "create", "edit", "cancel"],
  loaners: ["view", "manage", "return"],
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
