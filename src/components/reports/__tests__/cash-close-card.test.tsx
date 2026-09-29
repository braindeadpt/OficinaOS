// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockClose = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && "amount" in vars ? `${key}:${String(vars.amount)}` : key,
  }),
}));

vi.mock("@/stores/reports", () => ({
  useReportsStore: (selector: (s: unknown) => unknown) =>
    selector({ closeCashSession: mockClose }),
}));

vi.mock("@/components/reports/signature-pad", () => ({
  default: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button
      data-testid="signature-canvas"
      onClick={() => onChange("data:image/png;base64,AAA")}
      type="button"
    />
  ),
}));

import CashCloseCard from "../cash-close-card";

const openSession = {
  counted: { cash: null, nonCash: null, totalCollected: null },
  divergence: { cash: null },
  id: "cs-1",
  liveReport: {
    summary: { cashTotal: 112.5 },
  },
  openedAt: "2026-09-29T10:00:00.000Z",
  openedBy: { id: "u1", name: "Owner" },
  reopenCount: 0,
  status: "OPEN",
} as never;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CashCloseCard", () => {
  it("renders close form and previews divergence while typing", () => {
    render(<CashCloseCard onClosed={vi.fn()} session={openSession} />);

    const cashInput = screen.getByLabelText("reports.cashCountedCash");
    expect(cashInput).toBeInTheDocument();
    expect(
      screen.queryByTestId("cash-divergence-preview")
    ).not.toBeInTheDocument();

    fireEvent.change(cashInput, { target: { value: "100.5" } });

    const preview = screen.getByTestId("cash-divergence-preview");
    expect(preview).toHaveTextContent("reports.cashDivergencePreview:-12");
  });

  it("submits close with counted values and signature", async () => {
    const onClosed = vi.fn();
    mockClose.mockResolvedValue(undefined);
    render(<CashCloseCard onClosed={onClosed} session={openSession} />);

    fireEvent.change(screen.getByLabelText("reports.cashCountedCash"), {
      target: { value: "100.5" },
    });
    fireEvent.change(screen.getByLabelText("reports.cashCountedNonCash"), {
      target: { value: "187.5" },
    });
    fireEvent.click(screen.getByTestId("signature-canvas"));

    fireEvent.click(screen.getByTestId("cash-close-submit"));

    await vi.waitFor(() => {
      expect(mockClose).toHaveBeenCalledWith(
        expect.objectContaining({
          countedCash: 100.5,
          countedNonCash: 187.5,
          signatureDataUrl: "data:image/png;base64,AAA",
        })
      );
    });
    expect(onClosed).toHaveBeenCalled();
  });

  it("shows an error when the close request fails", async () => {
    mockClose.mockRejectedValue(new Error("boom"));
    render(<CashCloseCard onClosed={vi.fn()} session={openSession} />);

    fireEvent.change(screen.getByLabelText("reports.cashCountedCash"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByTestId("cash-close-submit"));

    await vi.waitFor(() => {
      expect(screen.getByText("reports.cashCloseError")).toBeInTheDocument();
    });
  });
});
