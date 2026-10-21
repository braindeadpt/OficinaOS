// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTechnicians } from "../use-technicians";

vi.mock("@/stores/users", () => ({
  useUsersStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      users: [
        { id: "owner", name: "Owner", role: "OWNER", isActive: true },
        { id: "tech", name: "Tech", role: "TECHNICIAN", isActive: true },
        { id: "inactive", role: "OWNER", isActive: false },
        { id: "desk", role: "FRONT_DESK", isActive: true },
      ],
      fetchUsers: vi.fn(),
      isLoading: false,
    }),
}));

describe("useTechnicians", () => {
  it("offers active owners and technicians without offering inactive users or reception", () => {
    const { result } = renderHook(() => useTechnicians());
    expect(result.current.technicians).toEqual([
      { id: "owner", name: "Owner" },
      { id: "tech", name: "Tech" },
    ]);
  });
});
