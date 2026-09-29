// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-modal-effects", () => ({
  useModalEffects: vi.fn(),
}));

vi.mock("@/lib/error-buffer", () => ({
  getRecentErrors: () => ["[error] something broke"],
}));

const mockPost = vi.fn();
vi.mock("@/lib/api", () => ({
  default: { post: (...args: unknown[]) => mockPost(...args) },
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock("@/i18n", () => ({ default: { language: "pt-PT" } }));

import ReportProblemModal from "../report-problem-modal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportProblemModal", () => {
  const defaultProps = { onClose: vi.fn(), open: true };

  it("renders the dialog when open", () => {
    render(<ReportProblemModal {...defaultProps} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "report_problem.title" })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("report_problem.description_label")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("report_problem.contact_label")
    ).toBeInTheDocument();
  });

  it("blocks submit when the description is too short", async () => {
    render(<ReportProblemModal {...defaultProps} />);
    fireEvent.change(
      screen.getByLabelText("report_problem.description_label"),
      { target: { value: "short" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "report_problem.submit" })
    );
    await waitFor(() => {
      expect(
        screen.getByText("report_problem.error_description_required")
      ).toBeInTheDocument();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("posts the report with context and closes on success", async () => {
    const onClose = vi.fn();
    mockPost.mockResolvedValue({ data: { issueNumber: 7 } });
    render(<ReportProblemModal onClose={onClose} open />);
    fireEvent.change(
      screen.getByLabelText("report_problem.description_label"),
      { target: { value: "O recibo saiu com o total errado" } }
    );
    fireEvent.change(screen.getByLabelText("report_problem.contact_label"), {
      target: { value: "912345678" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "report_problem.submit" })
    );
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        "/feedback/report",
        expect.objectContaining({
          description: "O recibo saiu com o total errado",
          contact: "912345678",
          context: expect.objectContaining({
            locale: "pt-PT",
            errors: ["[error] something broke"],
          }),
        })
      );
      expect(onClose).toHaveBeenCalled();
    });
  });
});
