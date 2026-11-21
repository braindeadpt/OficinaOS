// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api";
import {
  invalidateIntakeTermsCache,
  useIntakeTermsSession,
} from "../use-intake-terms";

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
    invalidateIntakeTermsCache();
  });

  it("stays undefined until the intake opens, then resolves custom terms", async () => {
    get.mockResolvedValue({ data: { intakeTerms: "Cláusulas da loja" } });
    const { result, rerender } = renderSession();

    expect(result.current).toBeUndefined();
    expect(get).not.toHaveBeenCalled();

    rerender({ active: true });
    await waitFor(() => expect(result.current).toBe("Cláusulas da loja"));
    expect(get).toHaveBeenCalledWith("/settings/intake-terms");
  });

  it("resolves null when the shop uses the app default", async () => {
    get.mockResolvedValue({ data: { intakeTerms: null } });
    const { result } = renderSession(true);

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("re-resolves fresh terms after a settings save invalidates the cache", async () => {
    // Terms A resolved for the first intake.
    get.mockResolvedValue({ data: { intakeTerms: "Termos A" } });
    const { result, rerender } = renderSession();
    rerender({ active: true });
    await waitFor(() => expect(result.current).toBe("Termos A"));

    // Owner saves terms B — saveShopSettings invalidates the cache — then
    // opens a new intake WITHOUT leaving the page (the reported bug: the
    // dashboard kept submitting A while the form displayed B).
    invalidateIntakeTermsCache();
    get.mockResolvedValue({ data: { intakeTerms: "Termos B" } });
    rerender({ active: false });
    rerender({ active: true });

    await waitFor(() => expect(result.current).toBe("Termos B"));
  });

  it("keeps cached terms across intakes when nothing changed", async () => {
    get.mockResolvedValue({ data: { intakeTerms: "Termos A" } });
    const { result, rerender } = renderSession();
    rerender({ active: true });
    await waitFor(() => expect(result.current).toBe("Termos A"));

    rerender({ active: false });
    rerender({ active: true });

    await waitFor(() => expect(result.current).toBe("Termos A"));
    expect(get).toHaveBeenCalledTimes(1);
  });
});
