// @vitest-environment jsdom

import type { Job } from "@shared/types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockRemovePart = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/jobs", () => ({
  useJobsStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ removePart: mockRemovePart }),
}));

vi.mock("@/stores/parts-catalog", () => ({
  usePartsCatalogStore: () => ({
    parts: [],
    isLoading: false,
    fetchParts: vi.fn(),
  }),
}));

vi.mock("../add-part-dialog", () => ({
  default: ({
    open,
    onClose,
    onAdded,
    jobId,
  }: {
    open: boolean;
    onClose: () => void;
    onAdded: () => void;
    jobId: string;
  }) =>
    open ? (
      <div data-job-id={jobId} data-testid="add-part-dialog">
        <button onClick={onAdded} type="button">
          Mock Added
        </button>
        <button onClick={onClose} type="button">
          Mock Close
        </button>
      </div>
    ) : null,
  __esModule: true,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/format", () => ({
  formatCurrency: (n: number) => n.toLocaleString(),
}));

vi.mock("@/components/modules/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import JobPartsSection from "../job-parts-section";

function makeJob(overrides: Record<string, unknown> = {}): Job {
  return {
    id: "job-1",
    jobCode: "RPR-001",
    accessCode: "ACC-001",
    customerId: "cust-1",
    customer: {
      id: "cust-1",
      name: "John",
      phone: "+1234567890",
    },
    deviceId: "dev-1",
    device: {
      id: "dev-1",
      brand: { name: "Apple" },
      model: "iPhone 15",
    },
    reportedProblem: "Broken screen",
    status: "IN_REPAIR",
    estimatedCost: 5000,
    depositAmount: 2000,
    estimatedDate: "2025-01-15",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-10"),
    isWarrantyReturn: false,
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Admin" },
    updatedById: "user-1",
    updatedBy: { id: "user-1", name: "Admin" },
    technicianId: null,
    technician: null,
    photos: [],
    notes: [],
    partsUsed: [],
    repairs: [],
    auditLogs: [],
    warrantyForJobId: null,
    warrantyForJob: null,
    warrantyReturns: [],
    color: null,
    conditionNotes: null,
    ...overrides,
  } as unknown as Job;
}

describe("JobPartsSection", () => {
  it("renders parts title and add button for active job", () => {
    render(<JobPartsSection job={makeJob()} />);
    expect(screen.getByText("jobs_parts_title")).toBeInTheDocument();
    expect(screen.getAllByText("jobs_parts_add").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("shows add part button for non-terminal status", () => {
    render(<JobPartsSection job={makeJob({ status: "IN_REPAIR" })} />);
    expect(screen.getAllByText("jobs_parts_add").length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("hides add part button for terminal status", () => {
    const terminalStatuses = ["DELIVERED", "RETURNED", "CANCELLED"];
    for (const status of terminalStatuses) {
      const { unmount } = render(
        <JobPartsSection job={makeJob({ status: status as Job["status"] })} />
      );
      expect(screen.queryByText("jobs_parts_add")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("opens AddPartDialog when add button is clicked", () => {
    render(<JobPartsSection job={makeJob()} />);
    expect(screen.queryByTestId("add-part-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("jobs_parts_add")[0]);
    expect(screen.getByTestId("add-part-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("add-part-dialog")).toHaveAttribute(
      "data-job-id",
      "job-1"
    );
  });

  it("shows empty state when no parts", () => {
    render(<JobPartsSection job={makeJob({ partsUsed: [] })} />);
    expect(screen.getByText("jobs_parts_empty_title")).toBeInTheDocument();
  });

  it("shows parts list when parts exist", () => {
    const job = makeJob({
      partsUsed: [
        {
          id: "part-1",
          jobId: "job-1",
          partName: "Screen",
          category: "SCREEN",
          unitPrice: 3000,
          quantity: 1,
          totalCost: 3000,
          supplier: "Supplier A",
          partId: null,
          createdAt: new Date(),
          createdById: "user-1",
        },
      ] as unknown as Job["partsUsed"],
    });
    render(<JobPartsSection job={job} />);
    expect(
      screen.queryByText("jobs_parts_empty_title")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Screen")).toBeInTheDocument();
  });

  it("calls onChanged when AddPartDialog reports onAdded", () => {
    const onChanged = vi.fn();
    render(<JobPartsSection job={makeJob()} onChanged={onChanged} />);
    fireEvent.click(screen.getAllByText("jobs_parts_add")[0]);
    expect(screen.getByTestId("add-part-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mock Added"));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
