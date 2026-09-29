import { describe, expect, it } from "vitest";
import type { ApiError } from "@/lib/api";
import { splitApiErrors } from "@/pages/auth/change-password";

const FALLBACK = "Could not change password.";

function apiError(
  overrides: Partial<ApiError> & { details?: unknown } = {}
): ApiError {
  return {
    code: "BAD_REQUEST",
    message: "Request failed",
    status: 400,
    ...overrides,
  } as ApiError;
}

describe("splitApiErrors", () => {
  it("attaches every server message to its own field", () => {
    const { fieldErrors, formError } = splitApiErrors(
      apiError({
        details: {
          errors: {
            newPassword: ["Too weak."],
            oldPassword: ["Incorrect password."],
          },
        },
      }),
      FALLBACK
    );

    expect(fieldErrors).toEqual({
      newPassword: "Too weak.",
      oldPassword: "Incorrect password.",
    });
    expect(formError).toBe("Request failed");
  });

  it("keeps the first message when a field reports several", () => {
    const { fieldErrors } = splitApiErrors(
      apiError({ details: { errors: { newPassword: ["First.", "Second."] } } }),
      FALLBACK
    );
    expect(fieldErrors.newPassword).toBe("First.");
  });

  it("routes unknown fields to the form-level message", () => {
    const { fieldErrors, formError } = splitApiErrors(
      apiError({ details: { errors: { somethingElse: ["Boom."] } } }),
      FALLBACK
    );
    expect(fieldErrors).toEqual({});
    expect(formError).toBe("Boom.");
  });

  it("falls back to the coded message when there are no field errors", () => {
    const { formError } = splitApiErrors(apiError(), FALLBACK);
    expect(formError).toBe("Request failed");
  });

  it("falls back to the generic message when there is no code", () => {
    const { formError } = splitApiErrors(
      apiError({ code: undefined, message: "" }),
      FALLBACK
    );
    expect(formError).toBe(FALLBACK);
  });
});
