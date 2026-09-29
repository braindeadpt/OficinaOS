import { JobStatus } from "@shared/constants";
import { describe, expect, it } from "vitest";
import {
  STATUS_TONES,
  statusContainerClass,
  statusDotClass,
} from "@/lib/status-colors";

const ALL_STATUSES = Object.values(JobStatus);

describe("status tones", () => {
  it("covers every job status", () => {
    expect(Object.keys(STATUS_TONES).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("gives every status a container and a dot", () => {
    for (const status of ALL_STATUSES) {
      expect(statusContainerClass(status)).toBeTruthy();
      expect(statusDotClass(status)).toBeTruthy();
    }
  });

  /**
   * The invariant the four old maps broke: On Hold rendered a red dot next to a
   * grey badge, and Returned a grey dot next to a red badge. A dot must never
   * contradict the container it sits in, so only an error container may carry an
   * error dot.
   */
  it("keeps the dot in the same colour family as its container", () => {
    for (const status of ALL_STATUSES) {
      const errorContainer =
        statusContainerClass(status).includes("error-container");
      expect(statusDotClass(status).includes("bg-error")).toBe(errorContainer);
    }
  });

  it("marks only Cancelled as cancelled", () => {
    const struck = ALL_STATUSES.filter((s) =>
      statusContainerClass(s).includes("line-through")
    );
    expect(struck).toEqual([JobStatus.CANCELLED]);
  });

  it("reads the container and dot from the same record", () => {
    for (const status of ALL_STATUSES) {
      expect(statusContainerClass(status)).toBe(STATUS_TONES[status].container);
      expect(statusDotClass(status)).toBe(STATUS_TONES[status].dot);
    }
  });
});
