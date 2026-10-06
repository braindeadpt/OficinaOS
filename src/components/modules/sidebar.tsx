import { ROLE_LABELS } from "@shared/constants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { Icon } from "@/components/ui/icon";
import { Wordmark } from "@/components/ui/wordmark";
import { can, useCan } from "@/hooks/use-can";
import { NAV_ITEMS } from "@/lib/navigation";
import { getInitials } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

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
    <aside className="fixed start-0 top-0 z-40 hidden h-dvh w-64 flex-col bg-surface-container-low p-4 lg:flex">
      <div className="mb-8 flex shrink-0 items-center gap-3 px-2 py-6">
        <img
          alt=""
          aria-hidden="true"
          className="h-10 w-10 shrink-0"
          height={40}
          src="/logo-mark.svg"
          width={40}
        />
        <div>
          <h1 className="text-xl">
            <Wordmark />
          </h1>
          <p className="font-medium text-on-surface-variant text-xs tracking-wide">
            {t("app_tagline")}
          </p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain">
        {navItems.map(({ icon, labelKey, to }) => (
          <NavLink
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 ${
                isActive
                  ? "translate-x-1 bg-surface-container-lowest font-semibold text-primary shadow-sm rtl:-translate-x-1"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-primary"
              }`
            }
            key={to}
            to={to}
          >
            <Icon name={icon} size="lg" />
            <span className="font-medium text-sm">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto shrink-0 space-y-3">
        <button
          className={`flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-on-primary transition-all duration-200 active:scale-[0.98] ${canCreateJob ? "" : "cursor-not-allowed opacity-50"}`}
          disabled={!canCreateJob}
          onClick={() => openIntakeModal()}
          type="button"
        >
          <Icon name="add_circle" size="lg" />
          <span>{t("new_checkin")}</span>
        </button>

        <div className="flex items-center gap-1">
          <NavLink
            className={({ isActive }) =>
              `flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-3 transition-all duration-200 ${
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
          </NavLink>
          <button
            aria-label={
              logoutPending
                ? t("auth_sign_out_confirm")
                : t("auth_sign_out_instead")
            }
            className={`flex shrink-0 items-center justify-center rounded-xl px-3 py-3 transition-all duration-200 ${
              logoutPending
                ? "bg-error-container font-medium text-on-error-container text-xs"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            }`}
            onClick={handleLogoutClick}
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
              <Icon className="text-lg" name="power_settings_new" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
