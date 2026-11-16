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

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
  },
}));

import RemoteSignatureDialog from "../intake-modal/remote-signature-dialog";

const DOC = {
  accessories: [],
  checklist: {},
  color: null,
  conditionNotes: null,
  customerEmail: null,
  customerName: "Bruno",
  customerPhone: "912345678",
  deposit: null,
  deviceBrand: "Apple",
  deviceCategory: null,
  deviceModel: "iPhone SE",
  estimatedCost: null,
  estimatedDelivery: null,
  imei: null,
  loaner: false,
  loanerNote: null,
  locale: "pt",
  problem: "Ecrã partido",
  repairs: [],
  termsText: "Termos",
  unlockCodeProvided: false,
  urgent: false,
  v: 2,
  warrantyReturn: false,
};

const defaultProps = {
  document: DOC,
  onClose: vi.fn(),
  onSignature: vi.fn(),
  open: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RemoteSignatureDialog", () => {
  it("shows a retry button when session creation fails", async () => {
    mockPost.mockRejectedValue(new Error("400"));
    mockGet.mockResolvedValue({ data: { urls: [], needsAppUrl: false } });

    render(<RemoteSignatureDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("intake.sign_remote_error")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "intake.sign_remote_retry" })
    ).toBeInTheDocument();
  });

  it("retry recreates the session and shows the cloud link", async () => {
    mockPost.mockRejectedValueOnce(new Error("400")).mockResolvedValueOnce({
      data: {
        cloudSignUrl: "https://cloud.oficinaos.app/sign/abc123",
        token: "abc123",
      },
    });
    mockGet.mockResolvedValue({
      data: { urls: ["http://192.168.1.5:4000"], needsAppUrl: false },
    });

    render(<RemoteSignatureDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("intake.sign_remote_error")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "intake.sign_remote_retry" })
    );

    await waitFor(() => {
      expect(screen.getByRole("img")).toBeInTheDocument();
    });
    expect(mockPost).toHaveBeenCalledTimes(2);
    const link = screen.getByDisplayValue(
      "https://cloud.oficinaos.app/sign/abc123"
    );
    expect(link).toBeInTheDocument();
  });

  it("needsAppUrl shows the config message without a retry button", async () => {
    mockPost.mockResolvedValue({ data: { cloudSignUrl: null, token: "abc" } });
    mockGet.mockResolvedValue({ data: { urls: [], needsAppUrl: true } });

    render(<RemoteSignatureDialog {...defaultProps} />);

    await waitFor(() => {
      expect(
        screen.getByText("intake.sign_remote_needs_app_url")
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "intake.sign_remote_retry" })
    ).not.toBeInTheDocument();
  });
});
