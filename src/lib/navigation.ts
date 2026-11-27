import type { PermissionCheck } from "@shared/permissions";

/**
 * The one place that knows what the app can navigate to.
 *
 * The sidebar and the bottom bar each used to carry their own copy of this
 * list, and the copies had already drifted: the sidebar had eleven entries
 * while the bottom bar had three plus an eight-entry "more" sheet, so adding a
 * destination meant editing two files and hoping they stayed in step.
 */
export interface NavItem {
  icon: string;
  labelKey: string;
  perm: PermissionCheck;
  to: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    icon: "dashboard",
    labelKey: "dashboard",
    to: "/",
    perm: { jobs: ["view"] },
  },
  { icon: "build", labelKey: "jobs", to: "/jobs", perm: { jobs: ["view"] } },
  {
    icon: "shopping_cart",
    labelKey: "workflow.orders",
    to: "/purchase-orders",
    perm: { parts: ["viewCatalog"] },
  },
  {
    icon: "confirmation_number",
    labelKey: "business.tickets",
    to: "/tickets",
    perm: { jobs: ["view"] },
  },
  {
    icon: "forum",
    labelKey: "business.messages",
    to: "/messages",
    perm: { settings: ["edit"] },
  },
  {
    icon: "inbox",
    labelKey: "inbox.nav",
    to: "/inbox",
    perm: { inbox: ["view"] },
  },
  {
    icon: "handshake",
    labelKey: "business.agreements",
    to: "/agreements",
    perm: { settings: ["edit"] },
  },
  {
    icon: "task_alt",
    labelKey: "tasks.title",
    to: "/tasks",
    perm: { jobs: ["view"] },
  },
  {
    icon: "inbox",
    labelKey: "requests_nav",
    to: "/requests",
    perm: { jobs: ["view"] },
  },
  {
    icon: "undo",
    labelKey: "returns_nav_label",
    to: "/returns",
    perm: { returns: ["viewSelf"] },
  },
  {
    icon: "currency_exchange",
    labelKey: "tradeins.nav_label",
    to: "/trade-ins",
    perm: { tradeins: ["view"] },
  },
  {
    icon: "phone_iphone",
    labelKey: "loaners.nav_label",
    to: "/loaners",
    perm: { loaners: ["view"] },
  },
  {
    icon: "travel_explore",
    labelKey: "parts_board.nav_label",
    to: "/part-requests",
    perm: { jobs: ["view"] },
  },
  {
    icon: "local_shipping",
    labelKey: "suppliers.nav_label",
    to: "/suppliers",
    perm: { parts: ["viewCatalog"] },
  },
  {
    icon: "assignment_return",
    labelKey: "rmas.nav_label",
    to: "/rmas",
    perm: { parts: ["viewCatalog"] },
  },
  {
    icon: "people",
    labelKey: "customers",
    to: "/customers",
    perm: { customers: ["view"] },
  },
  {
    icon: "inventory_2",
    labelKey: "parts_inventory",
    to: "/parts",
    perm: { parts: ["viewCatalog"] },
  },
  {
    icon: "point_of_sale",
    labelKey: "pos.nav_label",
    to: "/pos",
    perm: { sales: ["view"] },
  },
  {
    icon: "menu_book",
    labelKey: "repair_services",
    to: "/repairs",
    perm: { repairs: ["viewCatalog"] },
  },
  {
    icon: "monitoring",
    labelKey: "market_prices.nav_label",
    to: "/market-prices",
    perm: { repairs: ["viewCatalog"] },
  },
  {
    icon: "notifications",
    labelKey: "notifications",
    to: "/notifications",
    perm: { notifications: ["read"] },
  },
  {
    icon: "analytics",
    labelKey: "reports.label",
    to: "/reports",
    perm: { reports: ["viewSelf"] },
  },
  {
    icon: "punch_clock",
    labelKey: "ponto.nav_label",
    to: "/ponto",
    perm: { reports: ["viewShop"] },
  },
  {
    icon: "auto_awesome",
    labelKey: "ai_agent_title",
    to: "/ai-analyst",
    perm: { ai: ["access"] },
  },
  {
    icon: "settings",
    labelKey: "settings",
    to: "/settings",
    perm: { settings: ["view"] },
  },
  {
    icon: "help",
    labelKey: "help_nav",
    to: "/help",
    // notifications.read is the one permission every role holds — help is for everyone
    perm: { notifications: ["read"] },
  },
];

/**
 * Routes promoted to the always-visible bottom bar on small screens. Anything
 * in NAV_ITEMS that is not listed here goes into the "more" sheet, so a new
 * destination shows up in the sheet automatically.
 */
export const BOTTOM_NAV_PRIMARY: string[] = ["/", "/jobs", "/settings"];

/**
 * Entrada /ponto na navegação com o entitlement terminado: existindo
 * registos guardados, o destino tem de continuar visível como "Registos
 * de ponto (ACT)" — a lei obriga a conservar e apresentar o registo
 * durante 5 anos, mesmo depois de o plano Pro terminar. A página abre
 * nesse caso só o separador de exportação (só leitura). Sem entitlement
 * nem registos, a entrada fica escondida como antes — exceto se houver
 * limpeza de fotografias por concluir, porque o aviso vive na página.
 *
 * O rótulo ACT aplica-se a qualquer entrada visível com o módulo inativo:
 * misturar a limpeza pendente no sinal de "ativo" voltava a mostrar o
 * nome normal numa página que afinal está em modo só leitura.
 */
export function resolvePontoNavItems<
  T extends { labelKey: string; to: string },
>(
  items: T[],
  pontoEnabled: boolean | null,
  pontoHasRecords: boolean | null,
  pontoCleanupPending = false
): T[] {
  return items.flatMap((item) => {
    if (item.to !== "/ponto" || pontoEnabled) {
      return [item];
    }
    if (!(pontoHasRecords || pontoCleanupPending)) {
      return [];
    }
    return [{ ...item, labelKey: "ponto.act_nav_label" }];
  });
}
