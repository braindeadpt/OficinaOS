// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const mockTransitionStatus = vi.fn().mockResolvedValue({});
const mockAddPayment = vi.fn().mockResolvedValue({});

vi.mock("@/stores/jobs", () => ({
  useJobsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      addPayment: mockAddPayment,
      transitionStatus: mockTransitionStatus,
    }),
}));

const mockPrintJobReceipt = vi.fn();
vi.mock("@/lib/print", () => ({
  printJobReceipt: (id: string) => mockPrintJobReceipt(id),
  usesThermalPrinter: () => true,
}));

import DeliverJobDialog from "../deliver-job-dialog";

const QUOTED_RE = /deliver_dialog\.quoted_given/;
const DEPOSIT_RE = /deliver_dialog\.deposit/;
const LOANER_RE = /deliver_dialog\.loaner/;
const LOANER_NOTE_RE = /Nokia 105/;

const job = { id: "job-1", jobCode: "R-0001", status: "DONE" as const };

function renderDialog(balanceDue: number, onDelivered = vi.fn()) {
  render(
    <DeliverJobDialog
      balanceDue={balanceDue}
      job={job}
      onCancel={vi.fn()}
      onDelivered={onDelivered}
      open
    />
  );
  return onDelivered;
}

describe("DeliverJobDialog", () => {
  beforeEach(() => {
    mockTransitionStatus.mockClear();
    mockAddPayment.mockClear();
    mockPrintJobReceipt.mockClear();
  });

  it("records the payment for the balance, then delivers", async () => {
    const onDelivered = renderDialog(120);
    fireEvent.click(
      screen.getByRole("button", {
        name: "deliver_dialog.confirm_with_payment",
      })
    );
    await waitFor(() => expect(onDelivered).toHaveBeenCalled());
    expect(mockAddPayment).toHaveBeenCalledWith("job-1", {
      amount: 120,
      method: "CASH",
    });
    expect(mockTransitionStatus).toHaveBeenCalledWith("job-1", "DELIVERED");
    expect(mockAddPayment.mock.invocationCallOrder[0]).toBeLessThan(
      mockTransitionStatus.mock.invocationCallOrder[0]
    );
    expect(mockPrintJobReceipt).toHaveBeenCalledWith("job-1");
  });

  it("offers MB WAY and Multibanco as payment methods", () => {
    renderDialog(50);
    expect(
      screen.getByRole("option", { name: "payment_method.MB_WAY" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "payment_method.MULTIBANCO" })
    ).toBeInTheDocument();
  });

  it("requires an explicit acknowledgement to hand over unpaid", async () => {
    const onDelivered = renderDialog(80);
    // Untick "record payment" → the balance stays open.
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "deliver_dialog.confirm" })
    );
    expect(
      await screen.findByText("deliver_dialog.ack_required")
    ).toBeInTheDocument();
    expect(mockTransitionStatus).not.toHaveBeenCalled();
    expect(onDelivered).not.toHaveBeenCalled();
  });

  it("delivers a fully paid job straight away", async () => {
    const onDelivered = renderDialog(0);
    expect(screen.queryByText("deliver_dialog.record_payment")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "deliver_dialog.confirm" })
    );
    await waitFor(() => expect(onDelivered).toHaveBeenCalled());
    expect(mockAddPayment).not.toHaveBeenCalled();
    expect(mockTransitionStatus).toHaveBeenCalledWith("job-1", "DELIVERED");
  });

  it("shows the agreed quote, deposit and loaner device", () => {
    render(
      <DeliverJobDialog
        balanceDue={70}
        job={{
          ...job,
          depositAmount: 30,
          estimatedCost: 100,
          hasLoanerDevice: true,
          loanerNote: "Nokia 105",
        }}
        onCancel={vi.fn()}
        onDelivered={vi.fn()}
        open
      />
    );
    expect(screen.getByText(QUOTED_RE)).toBeInTheDocument();
    expect(screen.getByText(DEPOSIT_RE)).toBeInTheDocument();
    expect(screen.getByText(LOANER_RE)).toBeInTheDocument();
    expect(screen.getByText(LOANER_NOTE_RE)).toBeInTheDocument();
  });

  it("hides the intake summary when nothing was agreed", () => {
    renderDialog(0);
    expect(screen.queryByText(QUOTED_RE)).toBeNull();
    expect(screen.queryByText(DEPOSIT_RE)).toBeNull();
    expect(screen.queryByText(LOANER_RE)).toBeNull();
  });
});
