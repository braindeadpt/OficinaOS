import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import type { ApiError } from "@/lib/api";
import {
  fetchMarketPrices,
  type MarketPriceStat,
  setPriceSharing,
} from "@/lib/api-market-prices";
import { formatPriceRange } from "@/lib/market-price-range";

type Gate = "ok" | "not-paired" | "no-module";
type KindFilter = "all" | "repair" | "part";

/** True when own price is well outside the market band (>25% off median). */
function farFromMarket(s: MarketPriceStat): boolean {
  if (s.ownPriceCents == null || s.medianCents <= 0) {
    return false;
  }
  return Math.abs(s.ownPriceCents - s.medianCents) / s.medianCents > 0.25;
}

export default function MarketPricesPage() {
  const { t } = useTranslation();
  const fmtCurrency = useFormatCurrency();
  const [stats, setStats] = useState<MarketPriceStat[]>([]);
  const [sharing, setSharing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gate, setGate] = useState<Gate>("ok");
  const [filter, setFilter] = useState<KindFilter>("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMarketPrices();
      setStats(res.stats);
      setSharing(res.sharing);
      setGate("ok");
    } catch (err) {
      const code = (err as ApiError).code;
      if (code === "CLOUD_NOT_PAIRED") {
        setGate("not-paired");
      } else if (code === "CLOUD_MODULE_REQUIRED") {
        setGate("no-module");
      } else {
        toast.error(t("market_prices.load_error"));
      }
      setStats([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSharing = async () => {
    setBusy(true);
    try {
      const next = !sharing;
      await setPriceSharing(next);
      setSharing(next);
      toast.success(
        t(next ? "market_prices.sharing_on" : "market_prices.sharing_off")
      );
    } catch {
      toast.error(t("market_prices.action_error"));
    } finally {
      setBusy(false);
    }
  };

  const filtered = stats.filter((s) => filter === "all" || s.kind === filter);
  const matched = filtered.filter((s) => s.ownPriceCents != null).length;

  let body: React.ReactNode;
  if (gate === "not-paired") {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          cloud_off
        </span>
        <p className="mt-4 max-w-sm font-medium text-on-surface-variant">
          {t("market_prices.not_paired")}
        </p>
      </div>
    );
  } else if (gate === "no-module") {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          lock
        </span>
        <p className="mt-4 max-w-sm font-medium text-on-surface-variant">
          {t("market_prices.no_module")}
        </p>
      </div>
    );
  } else if (loading) {
    body = (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  } else if (filtered.length === 0) {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          monitoring
        </span>
        <p className="mt-4 max-w-sm font-medium text-on-surface-variant">
          {t("market_prices.empty")}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {filtered.map((s) => (
          <div
            className="rounded-xl bg-surface-container-low p-5 shadow-sm"
            key={`${s.kind}:${s.key}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-primary-container/20 px-2 py-0.5 font-medium text-primary-container text-xs">
                    {t(`market_prices.kind_${s.kind}`)}
                  </span>
                  <span className="text-on-surface-variant text-xs">
                    {t("market_prices.shops_count", { count: s.shopCount })}
                  </span>
                </div>
                <p className="mt-2 font-bold text-on-surface">{s.name}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-4 text-right">
                {s.ownPriceCents != null && (
                  <div>
                    <p className="text-on-surface-variant text-xs">
                      {t("market_prices.own_price")}
                    </p>
                    <p
                      className={`font-bold ${
                        farFromMarket(s) ? "text-error" : "text-on-surface"
                      }`}
                    >
                      {fmtCurrency(s.ownPriceCents / 100)}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-on-surface-variant text-xs">
                    {t("market_prices.median")}
                  </p>
                  <p className="font-bold text-primary">
                    {fmtCurrency(s.medianCents / 100)}
                  </p>
                </div>
                <div>
                  <p className="text-on-surface-variant text-xs">
                    {t("market_prices.range")}
                  </p>
                  <p className="font-medium text-on-surface text-sm">
                    {formatPriceRange(
                      s,
                      fmtCurrency,
                      t("market_prices.range_insufficient")
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("market_prices.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm">
            {t("market_prices.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-surface-container-low p-1">
            {(["all", "repair", "part"] as const).map((f) => (
              <button
                className={`rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                  filter === f
                    ? "bg-surface-container-lowest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                key={f}
                onClick={() => setFilter(f)}
                type="button"
              >
                {t(`market_prices.filter_${f}`)}
              </button>
            ))}
          </div>
          <button
            aria-label={t("requests_refresh")}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant transition-colors hover:text-on-surface"
            onClick={load}
            type="button"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
      </div>

      {gate === "ok" && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-low p-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-on-surface text-sm">
              {t("market_prices.share_label")}
            </p>
            <p className="mt-0.5 text-on-surface-variant text-xs">
              {t("market_prices.share_hint")}
              {matched > 0 &&
                ` · ${t("market_prices.matched_count", { count: matched })}`}
            </p>
          </div>
          <button
            aria-pressed={sharing}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50 ${
              sharing
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface"
            }`}
            disabled={busy}
            onClick={toggleSharing}
            type="button"
          >
            <span className="material-symbols-outlined text-lg">
              {sharing ? "check_circle" : "share"}
            </span>
            {sharing
              ? t("market_prices.sharing_active")
              : t("market_prices.share_button")}
          </button>
        </div>
      )}

      {body}
    </div>
  );
}
