// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api";
import { useIntakeTermsSession } from "../use-intake-terms";

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn() },
}));

const get = vi.mocked(api.get);

function renderSession(initialActive = false) {
  return renderHook(
    ({ active }: { active: boolean }) => useIntakeTermsSession(active),
    { initialProps: { active: initialActive } }
  );
}

describe("useIntakeTermsSession", () => {
  beforeEach(() => {
    get.mockReset();
  });

  it("stays undefined until the intake opens, then resolves custom terms", async () => {
    get.mockResolvedValue({ data: { intakeTerms: "Cláusulas da loja" } });
    const { result, rerender } = renderSession();

    expect(result.current.terms).toBeUndefined();
    expect(result.current.failed).toBe(false);
    expect(get).not.toHaveBeenCalled();

    rerender({ active: true });
    await waitFor(() => expect(result.current.terms).toBe("Cláusulas da loja"));
    expect(get).toHaveBeenCalledWith("/settings/intake-terms");
  });

  it("resolves null when the shop uses the app default", async () => {
    get.mockResolvedValue({ data: { intakeTerms: null } });
    const { result } = renderSession(true);

    await waitFor(() => expect(result.current.terms).toBeNull());
    expect(result.current.failed).toBe(false);
  });

  it("fetches fresh terms on every intake open — edits on another workstation propagate", async () => {
    // First intake resolves terms A.
    get.mockResolvedValue({ data: { intakeTerms: "Termos A" } });
    const { result, rerender } = renderSession();
    rerender({ active: true });
    await waitFor(() => expect(result.current.terms).toBe("Termos A"));

    // The owner saves terms B elsewhere; this tab never saved anything, so
    // no invalidation runs — the next open must still pick up B.
    get.mockResolvedValue({ data: { intakeTerms: "Termos B" } });
    rerender({ active: false });
    rerender({ active: true });

    await waitFor(() => expect(result.current.terms).toBe("Termos B"));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps the resolved terms frozen while the intake stays open", async () => {
    get.mockResolvedValue({ data: { intakeTerms: "Termos A" } });
    const { result } = renderSession(true);
    await waitFor(() => expect(result.current.terms).toBe("Termos A"));

    // A later open would see B, but THIS intake must not change mid-signature.
    get.mockResolvedValue({ data: { intakeTerms: "Termos B" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.terms).toBe("Termos A");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("flags failure without falling back to defaults, and retry recovers", async () => {
    get.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderSession(true);

    await waitFor(() => expect(result.current.failed).toBe(true));
    // Terms stays undefined — signing must remain disabled, never default.
    expect(result.current.terms).toBeUndefined();

    get.mockResolvedValue({ data: { intakeTerms: "Cláusulas da loja" } });
    result.current.retry();
    await waitFor(() => expect(result.current.terms).toBe("Cláusulas da loja"));
    expect(result.current.failed).toBe(false);
  });

  it("resets to loading state when the intake closes", async () => {
    get.mockResolvedValue({ data: { intakeTerms: "Termos A" } });
    const { result, rerender } = renderSession();
    rerender({ active: true });
    await waitFor(() => expect(result.current.terms).toBe("Termos A"));

    rerender({ active: false });
    expect(result.current.terms).toBeUndefined();
    expect(result.current.failed).toBe(false);
  });
});
