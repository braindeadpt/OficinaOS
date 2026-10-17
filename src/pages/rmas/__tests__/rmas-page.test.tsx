// @vitest-environment jsdom

import { listPartsQuerySchema } from "@shared/schemas/parts-catalog.schema";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SupplierRmasPage from "..";

const mocks = vi.hoisted(() => ({ get: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-can", () => ({ useCan: () => false }));
vi.mock("@/hooks/use-technicians", () => ({
  useTechnicians: () => ({ technicians: [] }),
}));
vi.mock("@/lib/api", () => ({ default: { get: mocks.get } }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

function translate(key: string) {
  return key;
}

describe("RMA supplier selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    false,
    true,
  ])("keeps registered suppliers selectable when parts fail: %s", async (partsFail) => {
    mocks.get.mockImplementation((url, options) => {
      if (url === "/suppliers") {
        return Promise.resolve({
          data: { data: [{ id: "s1", name: "ACME" }] },
        });
      }
      if (url === "/parts") {
        expect(listPartsQuerySchema.safeParse(options.params).success).toBe(
          true
        );
        if (partsFail) {
          return Promise.reject(new Error("parts unavailable"));
        }
        return Promise.resolve({ data: { parts: [] } });
      }
      return Promise.resolve({ data: { data: [] } });
    });
    render(
      <MemoryRouter>
        <SupplierRmasPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.queryByText("rmas.empty")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: "rmas.add" }));
    expect(screen.getByRole("option", { name: "ACME" })).toHaveValue("s1");
    if (partsFail) {
      expect(mocks.error).toHaveBeenCalledWith("rmas.load_failed");
    }
  });
});
