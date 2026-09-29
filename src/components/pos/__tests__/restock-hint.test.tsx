// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));

import RestockHint from "../restock-hint";

const SUGGESTION_RE = /pos\.restock_suggestion/;
const DAYS_LEFT_RE = /pos\.restock_days_left/;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RestockHint", () => {
  it("renders the suggestion with avg, days and quantity", async () => {
    mockGet.mockResolvedValue({
      data: {
        avgDailyConsumption: 1,
        daysOfStockLeft: 3,
        recentConsumedTotal: 30,
        reorderPoint: 14,
        soldOutNow: true,
        stockQuantity: 0,
        suggestedQuantity: 14,
        supplier: "iSupply",
        windowDays: 30,
      },
    });

    render(<RestockHint partId="part-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("restock-hint")).toBeInTheDocument();
    });
    expect(screen.getByText(SUGGESTION_RE)).toHaveTextContent(
      '"avg":"1","days":30,"qty":"14"'
    );
    expect(screen.getByText(DAYS_LEFT_RE)).toBeInTheDocument();
  });

  it("shows the no-data message without ledger history", async () => {
    mockGet.mockResolvedValue({
      data: {
        avgDailyConsumption: 0,
        daysOfStockLeft: null,
        recentConsumedTotal: 0,
        reorderPoint: 0,
        soldOutNow: true,
        stockQuantity: 0,
        suggestedQuantity: 0,
        supplier: null,
        windowDays: 30,
      },
    });

    render(<RestockHint partId="part-1" />);

    await waitFor(() => {
      expect(screen.getByText("pos.restock_no_data")).toBeInTheDocument();
    });
  });

  it("stays silent on request failure", async () => {
    mockGet.mockRejectedValue(new Error("boom"));

    render(<RestockHint partId="part-1" />);

    await waitFor(() => {
      expect(screen.queryByTestId("restock-hint")).not.toBeInTheDocument();
    });
  });
});
