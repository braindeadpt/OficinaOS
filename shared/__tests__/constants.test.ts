import {
  ACTIVE_STATUSES,
  INACTIVE_STATUSES,
  JOB_STATUS_FLOW,
  JobStatus,
} from "@shared/constants/job-statuses";
import { ROLE_LABELS, Role } from "@shared/constants/roles";
import { roles } from "@shared/permissions";
import { describe, expect, it } from "vitest";

describe("Job Status Constants", () => {
  it("has all expected statuses", () => {
    const statuses = Object.values(JobStatus);
    expect(statuses).toHaveLength(8);
    expect(statuses).toContain("INTAKE");
    expect(statuses).toContain("CANCELLED");
  });

  it("every status has a flow entry", () => {
    for (const status of Object.values(JobStatus)) {
      expect(JOB_STATUS_FLOW).toHaveProperty(status);
    }
  });

  it("allows IN_REPAIR -> WAITING_FOR_PARTS and back", () => {
    // A technician often only finds the missing part after opening the device.
    expect(JOB_STATUS_FLOW.IN_REPAIR).toContain("WAITING_FOR_PARTS");
    expect(JOB_STATUS_FLOW.WAITING_FOR_PARTS).toContain("IN_REPAIR");
  });

  it("terminal statuses have no outgoing transitions", () => {
    expect(JOB_STATUS_FLOW.DELIVERED).toEqual([]);
    expect(JOB_STATUS_FLOW.RETURNED).toEqual([]);
    expect(JOB_STATUS_FLOW.CANCELLED).toEqual([]);
  });

  it("active and inactive are disjoint and cover all statuses", () => {
    const active = new Set(ACTIVE_STATUSES);
    const inactive = new Set(INACTIVE_STATUSES);
    for (const s of active) {
      expect(inactive.has(s)).toBe(false);
    }
    expect(active.size + inactive.size).toBe(Object.values(JobStatus).length);
  });
});

describe("Role Constants", () => {
  it("has OWNER, TECHNICIAN, FRONT_DESK", () => {
    expect(Role.OWNER).toBe("OWNER");
    expect(Role.TECHNICIAN).toBe("TECHNICIAN");
    expect(Role.FRONT_DESK).toBe("FRONT_DESK");
  });

  it("every role has a label", () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_LABELS[role]).toBeDefined();
    }
  });

  it("every role has defined permissions", () => {
    for (const role of Object.values(Role)) {
      const roleDef = roles[role as keyof typeof roles];
      expect(roleDef).toBeDefined();
      expect(typeof roleDef.authorize).toBe("function");
    }
  });
});
