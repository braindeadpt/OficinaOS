import { createCustomerSchema } from "@shared/schemas/customer.schema";
import { createJobSchema } from "@shared/schemas/job.schema";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  initValidationI18n,
  localizeZodIssues,
  resolveValidationMessage,
  resolveZodErrors,
} from "../resolve-validation-messages";

const ZOD_ENGLISH = /Invalid input|expected|received/;

const VALID_JOB = {
  customerName: "Maria",
  customerPhone: "912345678",
  deviceBrand: "Apple",
  deviceModel: "iPhone 13",
  reportedProblem: "Ecrã partido",
};

function fieldErrors(schema: z.ZodType, input: unknown, locale: string) {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    throw new Error("expected a validation failure");
  }
  return resolveZodErrors(
    z.flattenError(parsed.error).fieldErrors as Record<
      string,
      string[] | undefined
    >,
    locale
  );
}

describe("localized Zod validation messages", () => {
  beforeAll(async () => {
    await initValidationI18n();
  });

  it("never leaks Zod's built-in English text", () => {
    const errors = fieldErrors(
      createJobSchema,
      { ...VALID_JOB, depositAmount: "abc" },
      "pt"
    );
    const all = Object.values(errors).flat().join(" ");
    expect(all).not.toMatch(ZOD_ENGLISH);
    expect(errors.depositAmount).toEqual(["Introduza um número válido"]);
  });

  it("maps a missing required field to the localized 'required' message", () => {
    const errors = fieldErrors(
      createJobSchema,
      { ...VALID_JOB, deviceModel: undefined },
      "pt"
    );
    expect(errors.deviceModel).toEqual([
      "Este campo é de preenchimento obrigatório",
    ]);
  });

  it("interpolates max length per locale", () => {
    const input = { name: "x".repeat(5000), phone: "912345678" };
    expect(fieldErrors(createCustomerSchema, input, "pt").name).toEqual([
      "Deve ter no máximo 120 caracteres",
    ]);
    const en = fieldErrors(createCustomerSchema, input, "en").name?.[0];
    expect(en).toContain("120");
    expect(en).not.toContain("{{max}}");
  });

  it("keeps hand-written schema messages", () => {
    const errors = fieldErrors(
      createCustomerSchema,
      { name: "", phone: "912345678" },
      "pt"
    );
    expect(errors.name).toEqual(["Introduza um nome de cliente"]);
  });

  it("localizes raw issue lists", () => {
    const parsed = z.object({ n: z.number() }).safeParse({ n: "1" });
    expect(parsed.success).toBe(false);
    const issues = localizeZodIssues(parsed.error?.issues ?? [], "pt");
    expect(issues[0]?.message).toBe("Introduza um número válido");
  });

  it("passes through non-key messages and tolerates malformed params", () => {
    expect(resolveValidationMessage("plain text", "pt")).toBe("plain text");
    expect(resolveValidationMessage("validations.required|{bad", "pt")).toBe(
      "Este campo é de preenchimento obrigatório"
    );
  });
});
