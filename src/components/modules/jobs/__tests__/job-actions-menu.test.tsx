// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { JobRow } from "../jobs-shared";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// print.ts pulls the real i18n chain (initReactI18next) — stub it so the
// jsdom test doesn't need the full module.
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const mockTransitionStatus = vi.fn().mockResolvedValue({});

vi.mock("@/stores/jobs", () => ({
  useJobsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ transitionStatus: mockTransitionStatus }),
}));

vi.mock("../job-note-dialog", () => ({
  default: () => <div data-testid="note-dialog" />,
  __esModule: true,
}));

vi.mock("../job-cancel-dialog", () => ({
  default: () => <div data-testid="cancel-dialog" />,
  __esModule: true,
}));

import JobActionsMenu from "../job-actions-menu";

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "test-id",
    customer: "John",
    device: "iPhone 15",
    deviceIcon: "smartphone",
    status: "IN_REPAIR",
    rawJob: {
      id: "raw-id",
      customer: { phone: "+1234567890" } as never,
    } as never,
    ...overrides,
  };
}

describe("JobActionsMenu", () => {
  it("renders the more_vert button", () => {
    render(<JobActionsMenu job={makeJob()} />);
    expect(
      screen.getByRole("button", { name: "job_actions" })
    ).toBeInTheDocument();
  });

  it("opens dropdown on button click", () => {
    render(<JobActionsMenu job={makeJob({ status: "INTAKE" })} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    expect(screen.getByText("job_actions_change_status")).toBeInTheDocument();
    expect(screen.getByText("job_actions_add_note")).toBeInTheDocument();
    expect(screen.getByText("job_actions_call_customer")).toBeInTheDocument();
    expect(screen.getByText("job_actions_print_receipt")).toBeInTheDocument();
    expect(screen.getByText("job_actions_cancel_job")).toBeInTheDocument();
  });

  it("shows only input-free transitions for INTAKE", () => {
    render(<JobActionsMenu job={makeJob({ status: "INTAKE" })} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    // INTAKE → [WAITING_FOR_PARTS, IN_REPAIR, ON_HOLD, CANCELLED];
    // ON_HOLD needs a reason and CANCELLED goes through the dialog.
    expect(screen.getByText("status.WAITING_FOR_PARTS")).toBeInTheDocument();
    expect(screen.getByText("status.IN_REPAIR")).toBeInTheDocument();
    expect(screen.queryByText("status.ON_HOLD")).not.toBeInTheDocument();
    expect(screen.queryByText("status.CANCELLED")).not.toBeInTheDocument();
  });

  it("offers only WAITING_FOR_PARTS for IN_REPAIR (the rest need input)", () => {
    render(<JobActionsMenu job={makeJob({ status: "IN_REPAIR" })} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    // IN_REPAIR → [WAITING_FOR_PARTS, ON_HOLD, DONE, CANCELLED] — ON_HOLD,
    // DONE and CANCELLED need a reason/QC/dialog.
    expect(screen.getByText("job_actions_change_status")).toBeInTheDocument();
    expect(screen.getByText("status.WAITING_FOR_PARTS")).toBeInTheDocument();
    expect(screen.queryByText("status.ON_HOLD")).not.toBeInTheDocument();
    expect(screen.queryByText("status.DONE")).not.toBeInTheDocument();
    expect(screen.getByText("job_actions_add_note")).toBeInTheDocument();
  });

  it("hides cancel option when CANCELLED not in valid transitions", () => {
    render(<JobActionsMenu job={makeJob({ status: "DONE" })} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    // DONE → ["DELIVERED", "RETURNED"], no CANCELLED
    expect(
      screen.queryByText("job_actions_cancel_job")
    ).not.toBeInTheDocument();
  });

  it("closes dropdown on Escape key", () => {
    render(<JobActionsMenu job={makeJob()} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    expect(screen.getByText("job_actions_add_note")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("job_actions_add_note")).not.toBeInTheDocument();
  });

  it("has enabled print receipt and print label buttons", () => {
    render(<JobActionsMenu job={makeJob()} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    const printReceiptBtn = screen
      .getByText("job_actions_print_receipt")
      .closest("button");
    const printLabelBtn = screen
      .getByText("job_actions_print_label")
      .closest("button");
    expect(printReceiptBtn).not.toBeNull();
    expect(printLabelBtn).not.toBeNull();
    expect(printReceiptBtn).not.toBeDisabled();
    expect(printLabelBtn).not.toBeDisabled();
  });

  it("renders nothing for terminal status without customer phone", () => {
    const { container } = render(
      <JobActionsMenu
        job={makeJob({ status: "DELIVERED", rawJob: undefined })}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("opens note dialog when Add Note is clicked", async () => {
    render(<JobActionsMenu job={makeJob()} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    fireEvent.click(screen.getByText("job_actions_add_note"));
    await waitFor(() => {
      expect(screen.getByTestId("note-dialog")).toBeInTheDocument();
    });
  });

  it("opens cancel dialog when Cancel Job is clicked", async () => {
    render(<JobActionsMenu job={makeJob()} />);
    fireEvent.click(screen.getByRole("button", { name: "job_actions" }));
    fireEvent.click(screen.getByText("job_actions_cancel_job"));
    await waitFor(() => {
      expect(screen.getByTestId("cancel-dialog")).toBeInTheDocument();
    });
  });
});
