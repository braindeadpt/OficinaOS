// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BusinessPage from "..";
import { BusinessHistory, SupplierCustomerLink } from "../history";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  can: vi.fn(),
}));
function translate(key: string) {
  return key;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@/lib/api", () => ({ default: mocks }));
vi.mock("@/hooks/use-can", () => ({ useCan: () => mocks.can() }));
vi.mock("@/components/modules/tasks/record-workflow", () => ({
  RecordWorkflow: () => null,
}));
describe("business forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.can.mockReturnValue(true);
    mocks.post.mockResolvedValue({});
    mocks.put.mockResolvedValue({});
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve({
        data:
          url === "/business/parties"
            ? {
                customers: [{ id: "c1", name: "Example customer" }],
                suppliers: [
                  { id: "s1", name: "Example supplier", customerId: null },
                ],
              }
            : { data: [], nextCursor: null },
      })
    );
  });
  it("creates a support ticket in a chosen area with existing customer and supplier", async () => {
    render(
      <MemoryRouter>
        <BusinessPage module="tickets" />
      </MemoryRouter>
    );
    await screen.findByRole("option", { name: "Example customer" });
    fireEvent.click(screen.getByText("business.add"));
    fireEvent.change(screen.getByLabelText("business.fields.title"), {
      target: { value: "Website unavailable" },
    });
    fireEvent.change(screen.getByLabelText("business.fields.area"), {
      target: { value: "Websites" },
    });
    fireEvent.change(screen.getByLabelText("business.fields.description"), {
      target: { value: "Check platform configuration" },
    });
    fireEvent.change(screen.getByLabelText("business.fields.customerId"), {
      target: { value: "c1" },
    });
    fireEvent.change(screen.getByLabelText("business.fields.supplierId"), {
      target: { value: "s1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/business/tickets",
        expect.objectContaining({
          title: "Website unavailable",
          area: "Websites",
          priority: "NORMAL",
          customerId: "c1",
          supplierId: "s1",
        })
      )
    );
  });
  it("saves outgoing messages as drafts and clearly states that channels are manual", async () => {
    render(
      <MemoryRouter>
        <BusinessPage module="messages" />
      </MemoryRouter>
    );
    expect(screen.getByText("business.manual_channels")).toBeInTheDocument();
    fireEvent.click(screen.getByText("business.add"));
    fireEvent.change(screen.getByLabelText("business.fields.subject"), {
      target: { value: "Repair update" },
    });
    fireEvent.change(screen.getByLabelText("business.fields.body"), {
      target: { value: "Part received" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "/business/messages",
        expect.objectContaining({
          subject: "Repair update",
          body: "Part received",
          channel: "EMAIL",
          direction: "OUTBOUND",
          deliveryStatus: "DRAFT",
        })
      )
    );
  });
  it("does not request private history when the user is not an administrator", () => {
    mocks.can.mockReturnValue(false);
    render(
      <MemoryRouter>
        <BusinessHistory entityId="c1" entityType="CUSTOMER" />
      </MemoryRouter>
    );
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.queryByText("business.history")).not.toBeInTheDocument();
  });
  it("links an existing supplier to a customer without recreating either party", async () => {
    render(
      <MemoryRouter>
        <SupplierCustomerLink supplierId="s1" />
      </MemoryRouter>
    );
    await screen.findByRole("option", { name: "Example customer" });
    fireEvent.change(screen.getByLabelText("business.fields.customerId"), {
      target: { value: "c1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith("/business/identity/s1", {
        customerId: "c1",
      })
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
