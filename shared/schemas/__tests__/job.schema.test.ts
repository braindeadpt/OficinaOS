import { describe, expect, it } from "vitest";
import { createJobSchema, updateJobSchema } from "../job.schema";

const VALID_JOB = {
  customerName: "Maria",
  customerPhone: "912345678",
  deviceBrand: "Apple",
  deviceModel: "iPhone 13",
  reportedProblem: "Ecrã partido",
};

describe("createJobSchema — estimatedCost", () => {
  it("accepts an intake without an estimate (priced after diagnosis)", () => {
    const parsed = createJobSchema.safeParse(VALID_JOB);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.estimatedCost).toBeUndefined();
  });

  it("accepts an explicit null estimate", () => {
    expect(
      createJobSchema.safeParse({ ...VALID_JOB, estimatedCost: null }).success
    ).toBe(true);
  });

  it("still validates a provided estimate", () => {
    expect(
      createJobSchema.safeParse({ ...VALID_JOB, estimatedCost: -1 }).success
    ).toBe(false);
    expect(
      createJobSchema.safeParse({ ...VALID_JOB, estimatedCost: 80 }).success
    ).toBe(true);
  });

  it("lets an update clear the estimate", () => {
    expect(updateJobSchema.safeParse({ estimatedCost: null }).success).toBe(
      true
    );
  });
});

describe("createJobSchema — length caps", () => {
  it("rejects an oversized customer name", () => {
    expect(
      createJobSchema.safeParse({ ...VALID_JOB, customerName: "x".repeat(121) })
        .success
    ).toBe(false);
  });
});
