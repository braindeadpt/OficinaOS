import { describe, expect, it } from "vitest";
import { userIdParamSchema } from "../auth.schema";
import { customerIdParamSchema } from "../customer.schema";
import { OPAQUE_ID_MAX, opaqueIdSchema } from "../id.schema";
import { createJobSchema, updateJobSchema } from "../job.schema";
import { markReadParamSchema } from "../notification.schema";

// The three ID shapes OficinaOS actually stores: Prisma cuid, better-auth
// random ID and the readable IDs used by the demo seed.
const PRISMA_CUID = "clx1a2b3c4d5e6f7g8h9i0j1";
const BETTER_AUTH_ID = "t6J2cU81yf8n3zrJ1syKROSeOmLYKUtL";
const DEMO_CUSTOMER_ID = "demo-cust-001";
const DEMO_USER_ID = "demo-user-owner";

describe("opaque ID validation", () => {
  it.each([
    PRISMA_CUID,
    BETTER_AUTH_ID,
    DEMO_CUSTOMER_ID,
    DEMO_USER_ID,
  ])("accepts %s", (id) => {
    expect(opaqueIdSchema.safeParse(id).success).toBe(true);
  });

  it("rejects empty and over-long IDs", () => {
    expect(opaqueIdSchema.safeParse("").success).toBe(false);
    expect(opaqueIdSchema.safeParse("   ").success).toBe(false);
    expect(
      opaqueIdSchema.safeParse("x".repeat(OPAQUE_ID_MAX + 1)).success
    ).toBe(false);
  });

  it("rejects path and control characters", () => {
    for (const bad of ["../etc", "a/b", "a\\b", "a b", "id%00", "a.b"]) {
      expect(opaqueIdSchema.safeParse(bad).success).toBe(false);
    }
    expect(
      opaqueIdSchema.safeParse("123e4567-e89b-12d3-a456-426614174000").success
    ).toBe(true);
  });
});

describe("route params and payloads accept non-cuid IDs", () => {
  it("accepts a demo customer id in GET /customers/:id", () => {
    expect(customerIdParamSchema.parse(DEMO_CUSTOMER_ID)).toBe(
      DEMO_CUSTOMER_ID
    );
  });

  it("accepts better-auth user ids in the profile activity route", () => {
    expect(userIdParamSchema.parse(BETTER_AUTH_ID)).toBe(BETTER_AUTH_ID);
  });

  it("accepts demo and better-auth ids when creating a job", () => {
    expect(
      createJobSchema.shape.customerId.safeParse(DEMO_CUSTOMER_ID).success
    ).toBe(true);
    expect(
      createJobSchema.shape.technicianId.safeParse(BETTER_AUTH_ID).success
    ).toBe(true);
  });

  it("accepts a better-auth technician id when updating a job", () => {
    expect(
      updateJobSchema.shape.technicianId.safeParse(BETTER_AUTH_ID).success
    ).toBe(true);
    expect(updateJobSchema.shape.technicianId.safeParse(null).success).toBe(
      true
    );
  });

  it("accepts readable notification ids", () => {
    expect(markReadParamSchema.parse({ id: "demo-notif-001" }).id).toBe(
      "demo-notif-001"
    );
  });
});
