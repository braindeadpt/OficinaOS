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

const mockCreate = vi.fn();
const mockClearError = vi.fn();

vi.mock("@/hooks/use-create-customer", () => ({
  useCreateCustomer: () => ({
    clearError: mockClearError,
    create: mockCreate,
    error: null,
    isCreating: false,
  }),
}));

vi.mock("@/hooks/use-modal-effects", () => ({
  useModalEffects: vi.fn(),
}));

import AddCustomerModal from "../add-customer-modal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddCustomerModal", () => {
  const defaultProps = {
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    open: true,
  };

  it("renders modal when open", () => {
    render(<AddCustomerModal {...defaultProps} />);

    expect(
      screen.getByRole("heading", { name: "add_customer_modal.title" })
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByLabelText("add_customer_modal.name")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("add_customer_modal.phone")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("add_customer_modal.email")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "add_customer_modal.submit" })
    ).toBeInTheDocument();
  });

  it("returns null when not open", () => {
    const { container } = render(
      <AddCustomerModal {...defaultProps} open={false} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows validation errors when name and phone are empty", () => {
    render(<AddCustomerModal {...defaultProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: "add_customer_modal.submit" })
    );

    expect(
      screen.getByText("add_customer_modal.error_name_required")
    ).toBeInTheDocument();
    expect(
      screen.getByText("add_customer_modal.error_phone_required")
    ).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("shows validation error for empty phone only when name is filled", () => {
    render(<AddCustomerModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("add_customer_modal.name"), {
      target: { value: "John" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "add_customer_modal.submit" })
    );

    expect(
      screen.queryByText("add_customer_modal.error_name_required")
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("add_customer_modal.error_phone_required")
    ).toBeInTheDocument();
  });

  it("clears field error when user starts typing", () => {
    render(<AddCustomerModal {...defaultProps} />);

    // Submit with empty fields to trigger errors
    fireEvent.click(
      screen.getByRole("button", { name: "add_customer_modal.submit" })
    );

    expect(
      screen.getByText("add_customer_modal.error_name_required")
    ).toBeInTheDocument();

    // Type in name field
    fireEvent.change(screen.getByLabelText("add_customer_modal.name"), {
      target: { value: "Jane" },
    });

    expect(
      screen.queryByText("add_customer_modal.error_name_required")
    ).not.toBeInTheDocument();
  });

  it("calls create and onSuccess/onClose on successful submit", async () => {
    mockCreate.mockResolvedValue({
      email: null,
      id: "cust-1",
      name: "John",
      phone: "+351912345678",
    });
    render(<AddCustomerModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("add_customer_modal.name"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByLabelText("add_customer_modal.phone"), {
      target: { value: "+351912345678" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "add_customer_modal.submit" })
    );

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: "John",
        phone: "+351912345678",
        email: undefined,
      });
    });

    expect(defaultProps.onSuccess).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("includes email when provided", async () => {
    mockCreate.mockResolvedValue({
      email: "john@example.com",
      id: "cust-1",
      name: "John",
      phone: "+351912345678",
    });
    render(<AddCustomerModal {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("add_customer_modal.name"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByLabelText("add_customer_modal.phone"), {
      target: { value: "+351912345678" },
    });
    fireEvent.change(screen.getByLabelText("add_customer_modal.email"), {
      target: { value: "john@example.com" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "add_customer_modal.submit" })
    );

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        name: "John",
        phone: "+351912345678",
        email: "john@example.com",
      });
    });
  });
});
