import { ROLE_LABELS } from "@shared/constants";
import type { PermissionCheck } from "@shared/permissions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { can, useCan } from "@/hooks/use-can";
import { getInitials } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

interface NavItem {
  icon: string;
  labelKey: string;
  perm: PermissionCheck;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
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

const FOCUS_VISIBLE =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

export default function Sidebar() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.role);
  const userName = useAuthStore((s) => s.user?.name || s.user?.username || "");
  const navItems = useMemo(
    () => NAV_ITEMS.filter((item) => can(role, item.perm)),
    [role]
  );
  const canCreateJob = useCan({ jobs: ["create"] });
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);

  useEffect(
    () => () => {
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
      }
    },
    []
  );

  const handleLogoutClick = useCallback(() => {
    if (!logoutPending) {
      setLogoutPending(true);
      logoutTimerRef.current = setTimeout(() => setLogoutPending(false), 3000);
      return;
    }
    useAuthStore.getState().logout();
  }, [logoutPending]);

  return (
    <aside className="fixed start-0 top-0 z-40 hidden h-screen w-64 flex-col bg-surface-container-low p-4 lg:flex">
      <div className="mb-8 flex items-center gap-3 px-2 py-6">
        <img
          alt=""
          aria-hidden="true"
          className="h-10 w-10 shrink-0"
          height={40}
          src="/logo-mark.svg"
          width={40}
        />
        <div>
          <h1 className="font-black font-headline text-primary text-xl tracking-tight">
            OficinaOS
          </h1>
          <p className="font-medium text-on-surface-variant text-xs tracking-wide">
            {t("app_tagline")}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5">
        {navItems.map(({ icon, labelKey, to }) => (
          <NavLink
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 ${FOCUS_VISIBLE} ${
                isActive
                  ? "translate-x-1 bg-surface-container-lowest font-semibold text-primary shadow-sm rtl:-translate-x-1"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-primary"
              }`
            }
            key={to}
            to={to}
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              {icon}
            </span>
            <span className="font-medium text-sm">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <button
          className={`flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-on-primary transition-all duration-200 active:scale-[0.98] ${FOCUS_VISIBLE} ${canCreateJob ? "" : "cursor-not-allowed opacity-50"}`}
          disabled={!canCreateJob}
          onClick={() => openIntakeModal()}
          type="button"
        >
          <span aria-hidden="true" className="material-symbols-outlined">
            add_circle
          </span>
          <span>{t("new_checkin")}</span>
        </button>

        <NavLink
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 ${FOCUS_VISIBLE} ${
              isActive
                ? "translate-x-1 bg-surface-container-lowest font-semibold text-primary shadow-sm rtl:-translate-x-1"
                : "text-on-surface-variant hover:bg-surface-container hover:text-primary"
            }`
          }
          to="/profile"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-on-primary text-sm">
            {getInitials(userName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-on-surface text-sm">
              {userName}
            </p>
            <p className="truncate text-on-surface-variant text-xs">
              {t(ROLE_LABELS[role])}
            </p>
          </div>
          <button
            aria-label={
              logoutPending
                ? t("auth_sign_out_confirm")
                : t("auth_sign_out_instead")
            }
            className={`flex items-center justify-center rounded-xl px-3 py-3 transition-all duration-200 ${FOCUS_VISIBLE} ${
              logoutPending
                ? "bg-error-container font-medium text-on-error-container text-xs"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            }`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleLogoutClick();
            }}
            title={
              logoutPending
                ? t("auth_sign_out_confirm")
                : t("auth_sign_out_instead")
            }
            type="button"
          >
            {logoutPending ? (
              t("auth_sign_out_confirm")
            ) : (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-lg"
              >
                power_settings_new
              </span>
            )}
          </button>
        </NavLink>
      </div>
    </aside>
  );
}
