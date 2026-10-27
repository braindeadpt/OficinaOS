import { describe, expect, it } from "vitest";
import { createCustomerSchema, updateCustomerSchema } from "../customer.schema";
import { preCheckSubmitSchema } from "../intake-request.schema";
import { createJobSchema } from "../job.schema";

const VALID_PHONE = "+351 912 345 678";

describe("customer phone validation", () => {
  it("rejects free text on create and update", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Rui", phone: "abc" }).success
    ).toBe(false);
    expect(updateCustomerSchema.safeParse({ phone: "123" }).success).toBe(
      false
    );
  });

  it("accepts national and international numbers", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Rui", phone: VALID_PHONE })
        .success
    ).toBe(true);
    expect(
      createCustomerSchema.safeParse({ name: "Rui", phone: "912345678" })
        .success
    ).toBe(true);
  });
});

describe("job and pre-check phone validation", () => {
  it("rejects text on job check-in and public pre-check", () => {
    expect(createJobSchema.shape.customerPhone.safeParse("abc").success).toBe(
      false
    );
    expect(
      preCheckSubmitSchema.shape.customerPhone.safeParse("abc").success
    ).toBe(false);
  });

  it("accepts a formatted phone on both", () => {
    expect(
      createJobSchema.shape.customerPhone.safeParse(VALID_PHONE).success
    ).toBe(true);
    expect(
      preCheckSubmitSchema.shape.customerPhone.safeParse(VALID_PHONE).success
    ).toBe(true);
  });
});
