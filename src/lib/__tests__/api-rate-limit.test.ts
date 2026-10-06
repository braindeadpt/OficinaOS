import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
  },
}));

import { rateLimitMessage } from "@/lib/api";

describe("rateLimitMessage", () => {
  it("falls back to the generic text without a usable wait", () => {
    expect(rateLimitMessage(undefined)).toBe("errors.rate_limited");
    expect(rateLimitMessage(Number.NaN)).toBe("errors.rate_limited");
  });

  it("speaks in seconds under a minute", () => {
    expect(rateLimitMessage(42)).toBe("errors.rate_limited_seconds:42");
    expect(rateLimitMessage(0.2)).toBe("errors.rate_limited_seconds:1");
  });

  it("rounds longer waits up to whole minutes", () => {
    expect(rateLimitMessage(60)).toBe("errors.rate_limited_minutes:1");
    expect(rateLimitMessage(900)).toBe("errors.rate_limited_minutes:15");
    expect(rateLimitMessage(61)).toBe("errors.rate_limited_minutes:2");
  });
});
