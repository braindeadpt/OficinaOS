// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GlobalSearch from "@/components/modules/global-search";
import type { SearchResult } from "@/lib/global-search";

const navigateMock = vi.fn();
const searchGlobalMock = vi.fn();

vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// global-search is partially mocked below, but importActual still evaluates it,
// which would pull in the api client and the i18n bootstrap.
vi.mock("@/lib/api", () => ({ default: { get: vi.fn() } }));

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
    group: "jobs",
    href: "/jobs/job-2",
    id: "job-2",
    jobCode: "OS-2026-0002",
    kind: "job",
    status: "DONE",
    subtitle: "Bruno Costa · Samsung S23",
    title: "OS-2026-0002",
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

function input(): HTMLInputElement {
  return screen.getByRole("combobox") as HTMLInputElement;
}

async function typeAndSettle(value: string) {
  fireEvent.change(input(), { target: { value } });
  await waitFor(() => {
    expect(searchGlobalMock).toHaveBeenCalledWith(value, expect.anything());
  });
}

function activeOptionText(): string | null {
  const active = document.querySelector('[aria-selected="true"]');
  return active?.textContent ?? null;
}

beforeEach(() => {
  navigateMock.mockReset();
  searchGlobalMock.mockReset();
  searchGlobalMock.mockResolvedValue(RESULTS);
});

describe("GlobalSearch", () => {
  it("exposes combobox semantics", () => {
    render(<GlobalSearch />);
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).toHaveAttribute("aria-autocomplete", "list");
  });

  it("does not search until the term is long enough", async () => {
    render(<GlobalSearch />);
    fireEvent.change(input(), { target: { value: "a" } });
    await new Promise((r) => setTimeout(r, 300));
    expect(searchGlobalMock).not.toHaveBeenCalled();
  });

  it("queries after the debounce and lists the results", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");

    await waitFor(() => {
      expect(searchGlobalMock).toHaveBeenCalledWith("ana", expect.anything());
    });
    expect(await screen.findByText("OS-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Ana Silva")).toBeInTheDocument();
  });

  it("starts with the first option highlighted", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    await waitFor(() => {
      expect(activeOptionText()).toContain("OS-2026-0001");
    });
  });

  it("moves down with ArrowDown and up with ArrowUp, wrapping around", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    await waitFor(() => {
      expect(activeOptionText()).toContain("OS-2026-0001");
    });

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(activeOptionText()).toContain("OS-2026-0002");

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(activeOptionText()).toContain("+351912345678");

    // Wraps back to the first option.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(activeOptionText()).toContain("OS-2026-0001");

    // And backwards.
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(activeOptionText()).toContain("+351912345678");
  });

  it("jumps to the last option with End and back with Home", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    await waitFor(() => {
      expect(activeOptionText()).toContain("OS-2026-0001");
    });

    fireEvent.keyDown(input(), { key: "End" });
    expect(activeOptionText()).toContain("+351912345678");

    fireEvent.keyDown(input(), { key: "Home" });
    expect(activeOptionText()).toContain("OS-2026-0001");
  });

  it("navigates to the highlighted option on Enter", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    await waitFor(() => {
      expect(activeOptionText()).toContain("OS-2026-0001");
    });

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledWith("/jobs/job-2");
  });

  it("clears the query after selecting", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    await waitFor(() => {
      expect(screen.getByText("OS-2026-0001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ana Silva"));
    expect(navigateMock).toHaveBeenCalledWith("/customers/cus-1");
    expect(input().value).toBe("");
  });

  it("closes the panel on Escape without clearing the term", async () => {
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    await screen.findByText("OS-2026-0001");

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input().value).toBe("ana");
  });

  it("does not point aria-controls at a listbox that is not there", async () => {
    searchGlobalMock.mockResolvedValue([]);
    render(<GlobalSearch />);
    await typeAndSettle("zzzz");
    await screen.findByText("search_no_results");

    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).not.toHaveAttribute("aria-controls");
  });

  it("shows a no-results message", async () => {
    searchGlobalMock.mockResolvedValue([]);
    render(<GlobalSearch />);
    await typeAndSettle("zzzz");
    expect(await screen.findByText("search_no_results")).toBeInTheDocument();
  });

  it("surfaces a search failure instead of staying blank", async () => {
    searchGlobalMock.mockRejectedValue(new Error("network down"));
    render(<GlobalSearch />);
    await typeAndSettle("ana");
    expect(await screen.findByRole("alert")).toHaveTextContent("search_error");
  });
});
