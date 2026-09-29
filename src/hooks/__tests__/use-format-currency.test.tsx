// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchShopSettings: vi.fn(),
  shopSettings: { value: null as { currency?: string } | null },
}));

vi.mock("@/stores/settings", () => ({
  useSettingsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      fetchShopSettings: mocks.fetchShopSettings,
      shopSettings: mocks.shopSettings.value,
    }),
}));

import { ShopSettingsProvider } from "@/components/providers/shop-settings-provider";
import {
  ShopCurrencyProvider,
  useFormatCurrency,
} from "../use-format-currency";

const EUR = /€/;
const USD = /\$/;
const GBP = /£/;

function Price() {
  const fmt = useFormatCurrency();
  return <span>{fmt(1234.5)}</span>;
}

describe("useFormatCurrency", () => {
  beforeEach(() => {
    mocks.fetchShopSettings.mockReset();
    mocks.fetchShopSettings.mockResolvedValue(undefined);
    mocks.shopSettings.value = null;
  });

  it("falls back to EUR outside a provider instead of throwing", () => {
    render(<Price />);
    expect(screen.getByText(EUR)).toBeDefined();
  });

  it("uses the currency published by the provider", () => {
    render(
      <ShopCurrencyProvider currency="USD">
        <Price />
      </ShopCurrencyProvider>
    );
    expect(screen.getByText(USD)).toBeDefined();
  });

  it("publishes the shop currency and fetches once for many consumers", async () => {
    const { rerender } = render(
      <ShopSettingsProvider>
        <Price />
        <Price />
      </ShopSettingsProvider>
    );

    expect(mocks.fetchShopSettings).toHaveBeenCalledTimes(1);

    mocks.shopSettings.value = { currency: "GBP" };
    rerender(
      <ShopSettingsProvider>
        <Price />
        <Price />
      </ShopSettingsProvider>
    );

    await vi.waitFor(() => expect(screen.getAllByText(GBP)).toHaveLength(2));
    expect(mocks.fetchShopSettings).toHaveBeenCalledTimes(1);
  });

  it("allows a retry after a failed load", async () => {
    mocks.fetchShopSettings.mockRejectedValueOnce(new Error("offline"));
    const first = render(
      <ShopSettingsProvider>
        <Price />
      </ShopSettingsProvider>
    );
    await vi.waitFor(() => expect(mocks.fetchShopSettings).toHaveBeenCalled());
    // let the rejected promise settle so the in-flight guard is released
    await act(async () => {
      await Promise.resolve();
    });
    first.unmount();

    render(
      <ShopSettingsProvider>
        <Price />
      </ShopSettingsProvider>
    );
    await vi.waitFor(() =>
      expect(mocks.fetchShopSettings).toHaveBeenCalledTimes(2)
    );
  });
});
