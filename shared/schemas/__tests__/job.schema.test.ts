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

describe("createJobSchema — loaner device", () => {
  it("accepts a job without loaner fields", () => {
    const parsed = createJobSchema.safeParse(VALID_JOB);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.hasLoanerDevice).toBeUndefined();
  });

  it("accepts a loaner flag and note", () => {
    const parsed = createJobSchema.safeParse({
      ...VALID_JOB,
      hasLoanerDevice: true,
      loanerNote: "Nokia 105 — loja",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.hasLoanerDevice).toBe(true);
    expect(parsed.data?.loanerNote).toBe("Nokia 105 — loja");
  });

  it("rejects an oversized loaner note", () => {
    expect(
      createJobSchema.safeParse({
        ...VALID_JOB,
        loanerNote: "x".repeat(201),
      }).success
    ).toBe(false);
  });

  it("lets an update clear the note and unset the flag", () => {
    const parsed = updateJobSchema.safeParse({
      hasLoanerDevice: false,
      loanerNote: null,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.loanerNote).toBeNull();
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
