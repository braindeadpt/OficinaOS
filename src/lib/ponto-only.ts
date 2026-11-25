import type { NavItem } from "@/lib/navigation";

export const PONTO_ONLY_NAV_PATHS = new Set(["/", "/ponto", "/settings"]);

const PONTO_ONLY_ALLOWED_PREFIXES = [
  "/ponto",
  "/settings",
  "/notifications",
  "/profile",
  "/help",
];

/** Rotas de UI que continuam a existir numa instância standalone de ponto. */
export function isPontoOnlyAllowedPath(pathname: string): boolean {
  if (pathname === "/") {
    return true;
  }
  return PONTO_ONLY_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** Filtro único para sidebar, bottom-nav e paleta no modo só ponto. */
export function navItemVisibleInPontoOnly(
  item: Pick<NavItem, "to">,
  isPontoOnly: boolean,
  canViewShopPonto = true
): boolean {
  if (!isPontoOnly) {
    return true;
  }
  if (item.to === "/") {
    return canViewShopPonto;
  }
  return PONTO_ONLY_NAV_PATHS.has(item.to);
}
