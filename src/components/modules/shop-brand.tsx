import { useEffect, useState } from "react";
import api from "@/lib/api";

export interface PublicShop {
  address: string | null;
  logoUrl: string | null;
  name: string | null;
  phone: string | null;
  warrantyDays: number;
}

// One request per page load: every public surface (tracking, pre-check,
// sign) reads the same cached shop identity.
let publicShopPromise: Promise<PublicShop | null> | null = null;

export function usePublicShop(): PublicShop | null {
  const [shop, setShop] = useState<PublicShop | null>(null);
  useEffect(() => {
    let alive = true;
    publicShopPromise ??= api
      .get("/public/shop")
      .then((res) => res.data as PublicShop)
      .catch(() => {
        publicShopPromise = null;
        return null;
      });
    publicShopPromise.then((value) => {
      if (alive) {
        setShop(value);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  return shop;
}

/** The shop's own logo and name; OficinaOS only until settings load. */
export function ShopBrand() {
  const shop = usePublicShop();
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = shop?.logoUrl && !logoFailed ? shop.logoUrl : "/logo-mark.svg";
  return (
    <>
      <img
        alt=""
        aria-hidden="true"
        className="h-8 w-auto max-w-[96px] object-contain"
        height={32}
        onError={() => setLogoFailed(true)}
        src={logo}
        width={32}
      />
      <span className="truncate font-bold font-headline text-2xl text-primary-container tracking-tight">
        {shop ? (shop.name ?? "OficinaOS") : " "}
      </span>
    </>
  );
}
