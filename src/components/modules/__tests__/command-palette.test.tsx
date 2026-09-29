// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "@/components/modules/command-palette";
import type { SearchResult } from "@/lib/global-search";
import { useCommandPaletteStore } from "@/stores/command-palette";

const navigateMock = vi.fn();
const searchGlobalMock = vi.fn();
const logoutMock = vi.fn();
const openIntakeMock = vi.fn();
const roleRef = { value: "OWNER" as string };

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The palette imports the api client transitively through global-search, and
// the real auth-client behind the permission check; both are stubbed so the
// module graph does not drag in the i18n bootstrap.
vi.mock("@/lib/api", () => ({ default: { get: vi.fn() } }));

vi.mock("@/hooks/use-can", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/use-can")>("@/hooks/use-can");
  return { ...actual, can: () => true };
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      logout: logoutMock,
      role: roleRef.value,
    }),
}));

vi.mock("@/stores/ui", () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openIntakeModal: openIntakeMock }),
}));

vi.mock("@/lib/global-search", async () => {
  const actual = await vi.importActual<typeof import("@/lib/global-search")>(
    "@/lib/global-search"
  );
  return {
    ...actual,
    searchGlobal: (...args: unknown[]) => searchGlobalMock(...args),
  };
});

const RESULTS: SearchResult[] = [
  {
    group: "jobs",
    href: "/jobs/job-1",
    id: "job-1",
    jobCode: "OS-2026-0001",
    kind: "job",
    status: "IN_REPAIR",
    subtitle: "Ana Silva · Apple iPhone 14",
    title: "OS-2026-0001",
  },
  {
    group: "customers",
    href: "/customers/cus-1",
    id: "cus-1",
    kind: "customer",
    subtitle: "+351912345678",
    title: "Ana Silva",
  },
];

const NO_RESULTS = /command_palette.no_results/;

function input(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

function activeOptionText(): string | null {
  const active = document.querySelector('[aria-selected="true"]');
  return active?.textContent ?? null;
}

function openPalette() {
  act(() => {
    useCommandPaletteStore.getState().open();
  });
}

async function typeAndSettle(value: string) {
  fireEvent.change(input(), { target: { value } });
  await waitFor(() => {
    expect(searchGlobalMock).toHaveBeenCalledWith(value, expect.anything());
  });
}

beforeEach(() => {
  navigateMock.mockReset();
  searchGlobalMock.mockReset();
  searchGlobalMock.mockResolvedValue(RESULTS);
  logoutMock.mockReset();
  openIntakeMock.mockReset();
  roleRef.value = "OWNER";
  act(() => {
    useCommandPaletteStore.setState({ isOpen: false });
  });
});

describe("CommandPalette", () => {
  it("stays closed until it is asked for", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Cmd+K from anywhere, with a combobox inside a dialog", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByRole("combobox")).toBeDefined();
  });

  it("also responds to Ctrl+K for non-Apple keyboards", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("closes on the same chord, so it behaves as a toggle", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists the navigation pages and the actions without querying", () => {
    render(<CommandPalette />);
    openPalette();

    expect(screen.getByText("command_palette.group_pages")).toBeDefined();
    expect(screen.getByText("command_palette.group_actions")).toBeDefined();
    expect(searchGlobalMock).not.toHaveBeenCalled();
  });

  it("does not search until the term is long enough", () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.change(input(), { target: { value: "a" } });
    expect(searchGlobalMock).not.toHaveBeenCalled();
  });

  it("queries after the debounce and appends the records", async () => {
    render(<CommandPalette />);
    openPalette();
    await typeAndSettle("ana");

    expect(screen.getByText("command_palette.group_records")).toBeDefined();
    expect(screen.getByText("Ana Silva")).toBeDefined();
  });

  it("navigates when a page command is selected with Enter", () => {
    render(<CommandPalette />);
    openPalette();

    // t is stubbed to echo the key, so labels are the translation keys.
    fireEvent.change(input(), { target: { value: "repair_services" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith("/repairs");
  });

  it("moves through the list with the arrow keys, wrapping around", () => {
    render(<CommandPalette />);
    openPalette();

    const first = activeOptionText();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    const second = activeOptionText();
    expect(second).not.toBe(first);

    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(activeOptionText()).toBe(first);
  });

  it("jumps to the ends with End and Home", () => {
    render(<CommandPalette />);
    openPalette();

    fireEvent.keyDown(input(), { key: "End" });
    const last = activeOptionText();
    fireEvent.keyDown(input(), { key: "Home" });
    expect(activeOptionText()).not.toBe(last);
  });

  it("opens the intake modal from the action command", () => {
    render(<CommandPalette />);
    openPalette();

    fireEvent.change(input(), { target: { value: "new_checkin" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(openIntakeMock).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("needs two presses to sign out, so a stray Enter is harmless", () => {
    render(<CommandPalette />);
    openPalette();

    fireEvent.change(input(), { target: { value: "auth_sign_out_instead" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(logoutMock).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(logoutMock).toHaveBeenCalled();
  });

  it("clears the filter on the first Escape and closes on the second", () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.change(input(), { target: { value: "settings" } });

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(input().value).toBe("");
    expect(screen.getByRole("dialog")).toBeDefined();

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when nothing matches", () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.change(input(), { target: { value: "zzzz" } });
    expect(screen.getByText(NO_RESULTS)).toBeDefined();
  });

  it("surfaces a failed lookup instead of staying blank", async () => {
    searchGlobalMock.mockRejectedValue(new Error("offline"));
    render(<CommandPalette />);
    openPalette();
    await typeAndSettle("ana");

    await waitFor(() => {
      expect(screen.getByText("command_palette.search_error")).toBeDefined();
    });
  });
});
