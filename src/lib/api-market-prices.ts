import api from "@/lib/api";

export interface MarketPriceStat {
  avgCents: number;
  category: string | null;
  key: string;
  kind: "repair" | "part";
  /** Null when too few shops report the item (the cloud hides the range). */
  maxCents: number | null;
  medianCents: number;
  /** Null when too few shops report the item (the cloud hides the range). */
  minCents: number | null;
  name: string;
  /** Own catalog price for the same normalized item, when it exists. */
  ownPriceCents: number | null;
  shopCount: number;
  updatedAt: string;
}

export interface MarketPricesResponse {
  sharing: boolean;
  stats: MarketPriceStat[];
}

export async function fetchMarketPrices(): Promise<MarketPricesResponse> {
  const res = await api.get<MarketPricesResponse>("/market-prices");
  return res.data;
}

export async function setPriceSharing(sharePrices: boolean): Promise<void> {
  await api.put("/market-prices", { sharePrices });
}
