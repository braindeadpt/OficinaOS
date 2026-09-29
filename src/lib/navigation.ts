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
    icon: "undo",
    labelKey: "returns_nav_label",
    to: "/returns",
    perm: { returns: ["viewSelf"] },
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
];

/**
 * Routes promoted to the always-visible bottom bar on small screens. Anything
 * in NAV_ITEMS that is not listed here goes into the "more" sheet, so a new
 * destination shows up in the sheet automatically.
 */
export const BOTTOM_NAV_PRIMARY: string[] = ["/", "/jobs", "/settings"];
