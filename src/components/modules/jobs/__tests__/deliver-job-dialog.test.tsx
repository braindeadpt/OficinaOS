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
});
