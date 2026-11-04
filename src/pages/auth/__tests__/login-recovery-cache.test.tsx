// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockChangeLanguage = vi.fn();
const mockLogin = vi.fn();
const mockClearError = vi.fn();
const mockCheckSession = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pt-PT", changeLanguage: mockChangeLanguage },
  }),
}));

vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  getErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

vi.mock("@/lib/demo", () => ({ useDemoMode: () => false }));

vi.mock("@/stores/auth", () => ({
  useAuthStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        login: mockLogin,
        error: null,
        clearError: mockClearError,
        checkSession: mockCheckSession,
      }),
    { setState: vi.fn(), getState: vi.fn() }
  ),
}));

vi.mock("@/i18n", () => ({ default: { language: "pt-PT" } }));

import LoginPage from "../login";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage — cache do probe de recuperação", () => {
  it("6 aberturas seguidas de «Esqueci-me da password» fazem 1 só pedido", async () => {
    // Regressão: o probe corria num useEffect do formulário — cada abertura
    // remontava o componente e gastava 1 do rate-limit (5/5min). Com cache
    // no estado da página, o endpoint só é pedido uma vez por carregamento.
    mockGet.mockImplementation((url: string) => {
      if (url === "/setup/status") {
        return Promise.resolve({ data: { needsSetup: false } });
      }
      if (url === "/auth/recovery-options") {
        return Promise.resolve({ data: { email: true } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    for (let i = 0; i < 6; i++) {
      fireEvent.click(
        await screen.findByRole("button", { name: "auth_forgot_password" })
      );
      await screen.findByRole("button", { name: "auth_back_to_sign_in" });
      fireEvent.click(
        screen.getByRole("button", { name: "auth_back_to_sign_in" })
      );
      await screen.findByRole("button", { name: "auth_forgot_password" });
    }

    await waitFor(() => {
      const probeCalls = mockGet.mock.calls.filter(
        ([url]) => url === "/auth/recovery-options"
      );
      expect(probeCalls).toHaveLength(1);
    });
  });
});
