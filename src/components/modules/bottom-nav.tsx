import { ROLE_LABELS } from "@shared/constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router";
import { can, useCan } from "@/hooks/use-can";
import { BOTTOM_NAV_PRIMARY, NAV_ITEMS } from "@/lib/navigation";
import { getInitials } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

const ACTIVE_FONT_SETTINGS = '"FILL" 1, "wght" 700, "GRAD" 0, "opsz" 24';

function MoreSheetProfile({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.role);
  const userName = useAuthStore((s) => s.user?.name || s.user?.username || "");
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <div className="mt-2 border-outline-variant/40 border-t pt-2">
      <div
        className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2 transition-[color,background-color] duration-200 ${
          logoutPending ? "bg-error-container" : ""
        }`}
      >
        {logoutPending ? (
          <>
            <span
              aria-hidden="true"
              className="material-symbols-outlined shrink-0 text-[22px] text-on-error-container"
            >
              warning
            </span>
            <span className="flex-1 font-semibold text-on-error-container text-sm">
              {t("auth_sign_out_confirm")}
            </span>
          </>
        ) : (
          <NavLink
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl"
            onClick={onClose}
            to="/profile"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-on-primary text-sm">
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
        )}
        <button
          aria-label={
            logoutPending
              ? t("auth_sign_out_confirm")
              : t("auth_sign_out_instead")
          }
          className={`flex shrink-0 items-center justify-center rounded-xl px-2 py-2 transition-[color,background-color] duration-200 ${
            logoutPending
              ? "font-semibold text-on-error-container"
              : "text-on-surface-variant active:bg-surface-container-high active:text-on-surface"
          }`}
          onClick={handleLogoutClick}
          title={
            logoutPending
              ? t("auth_sign_out_confirm")
              : t("auth_sign_out_instead")
          }
          type="button"
        >
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-[22px]"
          >
            {logoutPending ? "warning" : "power_settings_new"}
          </span>
        </button>
      </div>
    </div>
  );
}

function NavTab({
  icon,
  labelKey,
  to,
}: {
  icon: string;
  labelKey: string;
  to: string;
}) {
  const { t } = useTranslation();
  return (
    <NavLink
      className={({ isActive }) =>
        `flex min-h-[44px] min-w-0 flex-1 flex-col items-center rounded-xl px-1 py-1.5 transition-[color,background-color] duration-200 ${
          isActive
            ? "bg-primary/10 text-primary"
            : "text-on-surface-variant active:bg-surface-container-high active:text-primary"
        }`
      }
      to={to}
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={`material-symbols-outlined text-[22px] ${isActive ? "text-primary" : ""}`}
            style={
              isActive
                ? { fontVariationSettings: ACTIVE_FONT_SETTINGS }
                : undefined
            }
          >
            {icon}
          </span>
          <span
            className={`mt-0.5 text-[12px] leading-tight ${isActive ? "font-bold text-primary" : "text-on-surface-variant"}`}
          >
            {t(labelKey)}
          </span>
        </>
      )}
    </NavLink>
  );
}

function FabButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      aria-label={t("new_checkin")}
      className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-end px-1 pb-0.5"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={`-mt-7 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform duration-150 active:scale-95 motion-reduce:active:scale-100 ${
          disabled
            ? "bg-surface-container-highest opacity-50"
            : "bg-primary text-on-primary"
        }`}
      >
        <span
          aria-hidden="true"
          className={`material-symbols-outlined text-[26px] ${disabled ? "text-on-surface-variant" : "text-on-primary"}`}
          style={{ fontVariationSettings: ACTIVE_FONT_SETTINGS }}
        >
          add_circle
        </span>
      </span>
      <span
        className={`mt-0.5 text-[12px] leading-tight ${disabled ? "text-on-surface-variant" : "font-semibold text-primary"}`}
      >
        {t("new_checkin")}
      </span>
    </button>
  );
}

export default function BottomNav() {
  const { t } = useTranslation();
  const role = useAuthStore((s) => s.role);
  const canCreateJob = useCan({ jobs: ["create"] });
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);
  const moreSheetOpen = useUiStore((s) => s.moreSheetOpen);
  const openMoreSheet = useUiStore((s) => s.openMoreSheet);
  const closeMoreSheet = useUiStore((s) => s.closeMoreSheet);
  const location = useLocation();

  const visibleItems = NAV_ITEMS.filter(
    (item) => item.perm && can(role, item.perm)
  );
  // Everything the registry knows that is not pinned to the bottom bar.
  const visibleMoreItems = visibleItems.filter(
    (item) => !BOTTOM_NAV_PRIMARY.includes(item.to)
  );
  const isMoreActive = visibleMoreItems.some(
    (item) => item.to === location.pathname
  );

  useEffect(() => {
    if (!moreSheetOpen) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMoreSheet();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [moreSheetOpen, closeMoreSheet]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closeMoreSheet is a stable zustand action; we intentionally react to pathname changes
  useEffect(() => {
    closeMoreSheet();
  }, [location.pathname]);

  if (!role) {
    return null;
  }

  const visibleNavItemsByPath = new Map(
    visibleItems.map((item) => [item.to, item])
  );
  const dashboardItem = visibleNavItemsByPath.get("/");
  const jobsItem = visibleNavItemsByPath.get("/jobs");
  const settingsItem = visibleNavItemsByPath.get("/settings");

  const moreButton = (
    <button
      aria-expanded={moreSheetOpen}
      aria-label={t("more")}
      className={`flex min-h-[44px] min-w-0 flex-1 flex-col items-center rounded-xl px-1 py-1.5 transition-[color,background-color] duration-200 ${
        isMoreActive || moreSheetOpen
          ? "bg-primary/10 text-primary"
          : "text-on-surface-variant active:bg-surface-container-high active:text-primary"
      }`}
      onClick={moreSheetOpen ? closeMoreSheet : openMoreSheet}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`material-symbols-outlined text-[22px] ${isMoreActive || moreSheetOpen ? "text-primary" : ""}`}
        style={
          isMoreActive || moreSheetOpen
            ? { fontVariationSettings: ACTIVE_FONT_SETTINGS }
            : undefined
        }
      >
        more_horiz
      </span>
      <span
        className={`mt-0.5 text-[12px] leading-tight ${isMoreActive || moreSheetOpen ? "font-bold text-primary" : "text-on-surface-variant"}`}
      >
        {t("more")}
      </span>
    </button>
  );

  return (
    <>
      {moreSheetOpen && (
        <div
          aria-label={t("more_navigation")}
          aria-modal="true"
          className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden"
          role="dialog"
        >
          <button
            aria-label={t("close")}
            className="absolute inset-0 bg-on-surface/40 backdrop-blur-sm"
            onClick={closeMoreSheet}
            type="button"
          />
          <div className="pointer-events-auto relative flex max-h-[70vh] flex-col overflow-y-auto rounded-t-2xl bg-surface-container-low shadow-lg motion-reduce:block">
            <div className="mx-auto mt-2 h-1 w-8 shrink-0 rounded-full bg-on-surface-variant/30" />
            <nav className="flex-1 overflow-y-auto p-3 pb-20">
              {visibleMoreItems.map(({ icon, labelKey, to }) => (
                <NavLink
                  className={({ isActive }) =>
                    `flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-3 transition-[color,background-color] duration-200 ${
                      isActive
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-on-surface-variant active:bg-surface-container-high active:text-primary"
                    }`
                  }
                  key={to}
                  onClick={() => closeMoreSheet()}
                  to={to}
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden="true"
                        className={`material-symbols-outlined text-[22px] ${isActive ? "text-primary" : ""}`}
                        style={
                          isActive
                            ? { fontVariationSettings: ACTIVE_FONT_SETTINGS }
                            : undefined
                        }
                      >
                        {icon}
                      </span>
                      <span
                        className={`text-sm ${isActive ? "font-bold text-primary" : "text-on-surface-variant"}`}
                      >
                        {t(labelKey)}
                      </span>
                    </>
                  )}
                </NavLink>
              ))}

              <MoreSheetProfile onClose={closeMoreSheet} />
            </nav>
          </div>
        </div>
      )}

      <nav
        aria-label={t("navigation")}
        className="fixed right-0 bottom-0 left-0 z-50 flex items-center bg-surface-container-low px-1 pt-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--color-outline-variant)] backdrop-blur-sm lg:hidden"
      >
        {dashboardItem && (
          <NavTab
            icon={dashboardItem.icon}
            labelKey={dashboardItem.labelKey}
            to={dashboardItem.to}
          />
        )}
        {jobsItem && (
          <NavTab
            icon={jobsItem.icon}
            labelKey={jobsItem.labelKey}
            to={jobsItem.to}
          />
        )}
        <FabButton disabled={!canCreateJob} onClick={openIntakeModal} />
        {settingsItem && (
          <NavTab
            icon={settingsItem.icon}
            labelKey={settingsItem.labelKey}
            to={settingsItem.to}
          />
        )}
        {moreButton}
      </nav>
    </>
  );
}
