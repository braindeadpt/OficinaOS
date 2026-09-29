// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockUpdate = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/stores/customers", () => ({
  useCustomersStore: (selector: (s: unknown) => unknown) =>
    selector({ updateCustomer: mockUpdate }),
}));

import { toast } from "sonner";
import ConsentToggle from "../consent-toggle";

const customer = {
  id: "c1",
  name: "Ana Silva",
  whatsappConsent: false,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("ConsentToggle", () => {
  it("flips optimistically and toasts on success", async () => {
    mockUpdate.mockResolvedValue({});

    render(<ConsentToggle customer={customer} />);

    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("c1", {
        whatsappConsent: true,
      });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("customer_consent_optin_toast")
      );
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back and keeps silent on API failure", async () => {
    mockUpdate.mockRejectedValue(new Error("boom"));

    render(<ConsentToggle customer={customer} />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(toast.success).not.toHaveBeenCalled();
    });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("revokes consent when toggled off", async () => {
    mockUpdate.mockResolvedValue({});
    render(<ConsentToggle customer={{ ...customer, whatsappConsent: true }} />);

    fireEvent.click(screen.getByRole("switch"));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith("c1", {
        whatsappConsent: false,
      });
    });
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("customer_consent_revoke_toast")
    );
  });
});
