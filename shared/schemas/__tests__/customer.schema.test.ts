import { describe, expect, it } from "vitest";
import {
  CUSTOMER_NAME_MAX,
  createCustomerSchema,
  updateCustomerSchema,
} from "../customer.schema";

describe("customer schema length caps", () => {
  it("accepts a name at the cap and rejects one above it", () => {
    const base = { phone: "912345678" };
    expect(
      createCustomerSchema.safeParse({
        ...base,
        name: "x".repeat(CUSTOMER_NAME_MAX),
      }).success
    ).toBe(true);
    expect(
      createCustomerSchema.safeParse({ ...base, name: "x".repeat(5000) })
        .success
    ).toBe(false);
  });

  it("caps phone and email length", () => {
    expect(
      createCustomerSchema.safeParse({ name: "Rui", phone: "9".repeat(33) })
        .success
    ).toBe(false);
    expect(
      updateCustomerSchema.safeParse({
        email: `${"a".repeat(250)}@x.pt`,
      }).success
    ).toBe(false);
  });

  it("accepts the useExisting override flag", () => {
    const parsed = createCustomerSchema.safeParse({
      name: "Rui",
      phone: "912345678",
      useExisting: true,
    });
    expect(parsed.data?.useExisting).toBe(true);
  });
});
