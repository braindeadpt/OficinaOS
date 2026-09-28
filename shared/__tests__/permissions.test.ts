import {
  ac,
  frontDeskRole,
  ownerRole,
  roles,
  statement,
  technicianRole,
} from "@shared/permissions";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// statement shape
// ---------------------------------------------------------------------------

describe("statement", () => {
  it("has all expected business resource keys", () => {
    const keys = Object.keys(statement);
    expect(keys).toContain("jobs");
    expect(keys).toContain("jobStatus");
    expect(keys).toContain("parts");
    expect(keys).toContain("customers");
    expect(keys).toContain("repairs");
    expect(keys).toContain("reports");
    expect(keys).toContain("settings");
    expect(keys).toContain("notifications");
    expect(keys).toContain("ai");
  });

  it("includes 'user' and 'session' resource keys (from defaultStatements)", () => {
    const keys = Object.keys(statement);
    expect(keys).toContain("user");
    expect(keys).toContain("session");
  });
});

// ---------------------------------------------------------------------------
// roles map
// ---------------------------------------------------------------------------

describe("roles", () => {
  it("has OWNER, TECHNICIAN, FRONT_DESK keys", () => {
    expect(roles).toHaveProperty("OWNER");
    expect(roles).toHaveProperty("TECHNICIAN");
    expect(roles).toHaveProperty("FRONT_DESK");
  });

  it("role references match named exports", () => {
    expect(roles.OWNER).toBe(ownerRole);
    expect(roles.TECHNICIAN).toBe(technicianRole);
    expect(roles.FRONT_DESK).toBe(frontDeskRole);
  });
});

// ---------------------------------------------------------------------------
// ac (access control instance)
// ---------------------------------------------------------------------------

describe("ac", () => {
  it("is defined", () => {
    expect(ac).toBeDefined();
  });

  it("has newRole method", () => {
    expect(typeof ac.newRole).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// OWNER role
// ---------------------------------------------------------------------------

describe("OWNER role", () => {
  it("has all jobs actions including viewMargin, delete, assign", () => {
    const { jobs } = ownerRole.statements as { jobs: readonly string[] };
    expect(jobs).toContain("view");
    expect(jobs).toContain("create");
    expect(jobs).toContain("edit");
    expect(jobs).toContain("delete");
    expect(jobs).toContain("cancel");
    expect(jobs).toContain("assign");
    expect(jobs).toContain("selfAssign");
    expect(jobs).toContain("viewMargin");
  });

  it("has all jobStatus transitions", () => {
    const { jobStatus } = ownerRole.statements as {
      jobStatus: readonly string[];
    };
    expect(jobStatus).toContain("INTAKE");
    expect(jobStatus).toContain("WAITING_FOR_PARTS");
    expect(jobStatus).toContain("IN_REPAIR");
    expect(jobStatus).toContain("ON_HOLD");
    expect(jobStatus).toContain("DONE");
    expect(jobStatus).toContain("DELIVERED");
    expect(jobStatus).toContain("RETURNED");
    expect(jobStatus).toContain("CANCELLED");
  });

  it("has full parts actions", () => {
    const { parts } = ownerRole.statements as { parts: readonly string[] };
    expect(parts).toContain("viewCatalog");
    expect(parts).toContain("manageCatalog");
    expect(parts).toContain("add");
    expect(parts).toContain("remove");
    expect(parts).toContain("viewCost");
    expect(parts).toContain("setCost");
    expect(parts).toContain("overridePrice");
  });

  it("has all reports actions", () => {
    const { reports } = ownerRole.statements as { reports: readonly string[] };
    expect(reports).toContain("viewSelf");
    expect(reports).toContain("viewShop");
    expect(reports).toContain("viewMargin");
  });

  it("has settings view and edit", () => {
    const { settings } = ownerRole.statements as {
      settings: readonly string[];
    };
    expect(settings).toContain("view");
    expect(settings).toContain("edit");
  });

  it("has ai access", () => {
    expect(ownerRole.statements).toHaveProperty("ai");
    expect((ownerRole.statements as { ai: readonly string[] }).ai).toContain(
      "access"
    );
  });

  it("has full user admin actions", () => {
    const { user } = ownerRole.statements as { user: readonly string[] };
    expect(user).toContain("create");
    expect(user).toContain("list");
    expect(user).toContain("set-role");
    expect(user).toContain("ban");
    expect(user).toContain("impersonate");
    expect(user).toContain("delete");
    expect(user).toContain("set-password");
    expect(user).toContain("get");
    expect(user).toContain("update");
  });

  it("has session actions", () => {
    const { session } = ownerRole.statements as { session: readonly string[] };
    expect(session).toContain("list");
    expect(session).toContain("revoke");
    expect(session).toContain("delete");
  });
});

// ---------------------------------------------------------------------------
// TECHNICIAN role
// ---------------------------------------------------------------------------

describe("TECHNICIAN role", () => {
  it("has jobs edit, selfAssign, viewMargin but NOT assign or delete", () => {
    const { jobs } = technicianRole.statements as { jobs: readonly string[] };
    expect(jobs).toContain("view");
    expect(jobs).toContain("create");
    expect(jobs).toContain("edit");
    expect(jobs).toContain("selfAssign");
    expect(jobs).toContain("viewMargin");
    expect(jobs).not.toContain("assign");
    expect(jobs).not.toContain("delete");
  });

  it("has IN_REPAIR, DONE, CANCELLED jobStatus but NOT DELIVERED or RETURNED", () => {
    const { jobStatus } = technicianRole.statements as {
      jobStatus: readonly string[];
    };
    expect(jobStatus).toContain("WAITING_FOR_PARTS");
    expect(jobStatus).toContain("IN_REPAIR");
    expect(jobStatus).toContain("ON_HOLD");
    expect(jobStatus).toContain("DONE");
    expect(jobStatus).toContain("CANCELLED");
    expect(jobStatus).not.toContain("DELIVERED");
    expect(jobStatus).not.toContain("RETURNED");
    expect(jobStatus).not.toContain("INTAKE");
  });

  it("has parts with viewCost and setCost", () => {
    const { parts } = technicianRole.statements as { parts: readonly string[] };
    expect(parts).toContain("viewCatalog");
    expect(parts).toContain("add");
    expect(parts).toContain("remove");
    expect(parts).toContain("viewCost");
    expect(parts).toContain("setCost");
    expect(parts).toContain("overridePrice");
    expect(parts).not.toContain("manageCatalog");
  });

  it("has reports.viewSelf only", () => {
    const { reports } = technicianRole.statements as {
      reports: readonly string[];
    };
    expect(reports).toContain("viewSelf");
    expect(reports).not.toContain("viewShop");
    expect(reports).not.toContain("viewMargin");
  });

  it("has NO settings", () => {
    expect(technicianRole.statements).not.toHaveProperty("settings");
  });

  it("has user list and get", () => {
    const { user } = technicianRole.statements as { user: readonly string[] };
    expect(user).toContain("list");
    expect(user).toContain("get");
    expect(user).not.toContain("create");
    expect(user).not.toContain("delete");
    expect(user).not.toContain("set-role");
    expect(user).not.toContain("ban");
  });

  it("has NO session access", () => {
    expect(technicianRole.statements).not.toHaveProperty("session");
  });

  it("has ai access", () => {
    expect(technicianRole.statements).toHaveProperty("ai");
    const ai = technicianRole.statements.ai as readonly string[];
    expect(ai).toContain("access");
  });
});

// ---------------------------------------------------------------------------
// FRONT_DESK role
// ---------------------------------------------------------------------------

describe("FRONT_DESK role", () => {
  it("has jobs view, create, edit, cancel but NOT delete", () => {
    const { jobs } = frontDeskRole.statements as { jobs: readonly string[] };
    expect(jobs).toContain("view");
    expect(jobs).toContain("create");
    expect(jobs).toContain("edit");
    expect(jobs).toContain("cancel");
    expect(jobs).not.toContain("delete");
    expect(jobs).not.toContain("assign");
    expect(jobs).not.toContain("selfAssign");
    expect(jobs).not.toContain("viewMargin");
  });

  it("has DELIVERED, RETURNED, CANCELLED jobStatus but NOT IN_REPAIR or DONE", () => {
    const { jobStatus } = frontDeskRole.statements as {
      jobStatus: readonly string[];
    };
    expect(jobStatus).toContain("DELIVERED");
    expect(jobStatus).toContain("RETURNED");
    expect(jobStatus).toContain("CANCELLED");
    expect(jobStatus).not.toContain("IN_REPAIR");
    expect(jobStatus).not.toContain("DONE");
    expect(jobStatus).not.toContain("INTAKE");
    expect(jobStatus).not.toContain("WAITING_FOR_PARTS");
    expect(jobStatus).not.toContain("ON_HOLD");
  });

  it("has NO parts access", () => {
    expect(frontDeskRole.statements).not.toHaveProperty("parts");
  });

  it("has NO reports access", () => {
    expect(frontDeskRole.statements).not.toHaveProperty("reports");
  });

  it("has NO settings access", () => {
    expect(frontDeskRole.statements).not.toHaveProperty("settings");
  });

  it("has customers view, create, edit", () => {
    const { customers } = frontDeskRole.statements as {
      customers: readonly string[];
    };
    expect(customers).toContain("view");
    expect(customers).toContain("create");
    expect(customers).toContain("edit");
  });

  it("has notifications read and send", () => {
    const { notifications } = frontDeskRole.statements as {
      notifications: readonly string[];
    };
    expect(notifications).toContain("read");
    expect(notifications).toContain("send");
    expect(notifications).not.toContain("manage");
  });

  it("has NO ai access", () => {
    expect(frontDeskRole.statements).not.toHaveProperty("ai");
  });

  it("has user create, list, get, update", () => {
    const { user } = frontDeskRole.statements as { user: readonly string[] };
    expect(user).toContain("create");
    expect(user).toContain("list");
    expect(user).toContain("get");
    expect(user).toContain("update");
    expect(user).not.toContain("delete");
    expect(user).not.toContain("set-role");
    expect(user).not.toContain("ban");
  });

  it("has NO session access", () => {
    expect(frontDeskRole.statements).not.toHaveProperty("session");
  });

  it("has full payments access", () => {
    const { payments } = frontDeskRole.statements as {
      payments: readonly string[];
    };
    expect(payments).toEqual(["view", "create", "delete"]);
  });
});

// ---------------------------------------------------------------------------
// authorize() runtime behavior
// ---------------------------------------------------------------------------

describe("authorize() runtime behavior", () => {
  it("denies TECHNICIAN the assign action", () => {
    expect(technicianRole.authorize({ jobs: ["assign"] }).success).toBe(false);
  });
  it("grants FRONT_DESK the DELIVERED status transition", () => {
    expect(frontDeskRole.authorize({ jobStatus: ["DELIVERED"] }).success).toBe(
      true
    );
  });
  it("denies FRONT_DESK the IN_REPAIR status transition", () => {
    expect(frontDeskRole.authorize({ jobStatus: ["IN_REPAIR"] }).success).toBe(
      false
    );
  });
});
