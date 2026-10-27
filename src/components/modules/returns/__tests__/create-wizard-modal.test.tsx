// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { createReturnClaim } from "@/lib/api-return-claims";
import CreateWizardModal from "../create-wizard-modal";

vi.mock("@/lib/api-return-claims", () => ({
  createReturnClaim: vi.fn(),
}));

const WIZARD_NEXT_REGEX = /next/i;
const WIZARD_ACCEPT_REGEX = /aceitar|accept/i;
const WIZARD_REJECT_REGEX = /not a warranty case|returns_wizard_reject/i;
const SUBMIT_ERROR_REGEX = /could not create|não foi possível/i;

function wrap(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </MemoryRouter>
  );
}

const fakeJob = {
  customer: { id: "c1", name: "John" },
  id: "job-1",
  jobCode: "RPR-001",
  parts: [],
  repairs: [
    {
      daysSinceDelivered: 5,
      id: "jr-1",
      kind: "repair" as const,
      name: "Screen",
      warrantyDays: 30,
    },
  ],
};

describe("CreateWizardModal", () => {
  it("renders nothing when closed", () => {
    const { container } = wrap(
      <CreateWizardModal
        onClose={vi.fn()}
        onCreateNewPaidJob={vi.fn()}
        open={false}
        originalJob={fakeJob}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks Next until reason is provided", () => {
    wrap(
      <CreateWizardModal
        onClose={vi.fn()}
        onCreateNewPaidJob={vi.fn()}
        open
        originalJob={fakeJob}
      />
    );
    expect(
      screen.getByRole("button", { name: WIZARD_NEXT_REGEX })
    ).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "screen broken" },
    });
    expect(
      screen.getByRole("button", { name: WIZARD_NEXT_REGEX })
    ).toBeEnabled();
  });

  it("keeps the wizard open and shows an error when submission fails", async () => {
    const onClose = vi.fn();
    vi.mocked(createReturnClaim).mockRejectedValue(new Error("network"));
    wrap(
      <CreateWizardModal
        onClose={onClose}
        onCreateNewPaidJob={vi.fn()}
        open
        originalJob={fakeJob}
      />
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "screen broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: WIZARD_NEXT_REGEX }));
    fireEvent.click(screen.getByRole("button", { name: WIZARD_ACCEPT_REGEX }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      SUBMIT_ERROR_REGEX
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onCreateNewPaidJob when reject button clicked on step 2", () => {
    const onCreateNewPaidJob = vi.fn();
    const onClose = vi.fn();
    wrap(
      <CreateWizardModal
        onClose={onClose}
        onCreateNewPaidJob={onCreateNewPaidJob}
        open
        originalJob={fakeJob}
      />
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: WIZARD_NEXT_REGEX }));
    fireEvent.click(screen.getByRole("button", { name: WIZARD_REJECT_REGEX }));
    expect(onClose).toHaveBeenCalled();
    expect(onCreateNewPaidJob).toHaveBeenCalled();
  });
});
