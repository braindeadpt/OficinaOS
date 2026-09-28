import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useCan } from "@/hooks/use-can";
import { useWs } from "@/hooks/use-ws";
import { useAlertsStore } from "@/stores/alerts";
import { useUiStore } from "@/stores/ui";
import LanguageToggle from "./language-toggle";

export default function TopBar() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [showAlerts, setShowAlerts] = useState(false);
  const canCreateJob = useCan({ jobs: ["create"] });
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);
  const alerts = useAlertsStore((s) => s.alerts);
  const addAlert = useAlertsStore((s) => s.addAlert);
  const markRead = useAlertsStore((s) => s.markRead);
  const unreadCount = useAlertsStore((s) => s.unreadCount);
  const fetchAlerts = useAlertsStore((s) => s.fetchAlerts);
  const initialized = useAlertsStore((s) => s.initialized);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialized) {
      fetchAlerts();
    }
  }, [initialized, fetchAlerts]);

  useWs((msg) => {
    if (msg.type === "NOTIFICATION" && msg.notification) {
      addAlert(msg.notification);
    }
  });

  const handleToggleAlerts = useCallback(() => {
    setShowAlerts((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!showAlerts) {
      return;
    }
    function onClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setShowAlerts(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showAlerts]);

  return (
    <header className="fixed start-0 top-0 z-40 flex h-16 w-full items-center justify-between border-outline-variant border-b bg-surface/95 px-4 shadow-sm backdrop-blur-sm md:px-8 lg:start-64 lg:w-[calc(100%-16rem)]">
      <div className="flex flex-1 items-center gap-4">
        <div className="flex items-center gap-2 lg:hidden">
          <img
            alt=""
            aria-hidden="true"
            className="h-6 w-6"
            height="24"
            src="/logo-mark.svg"
            width="24"
          />
          <span className="font-black font-headline text-on-surface text-sm uppercase tracking-tighter">
            OficinaOS
          </span>
        </div>
        <div className="group relative hidden w-full max-w-xs md:block md:w-96">
          <span className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
            search
          </span>
          <input
            className="w-full rounded-full border-none bg-surface-container-high py-2 ps-10 pe-4 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/20"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search")}
            type="text"
            value={search}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 md:gap-3">
        <LanguageToggle />
        <div className="relative" ref={dropdownRef}>
          <button
            aria-label={t("notifications")}
            className="relative flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            onClick={handleToggleAlerts}
            type="button"
          >
            <span className="material-symbols-outlined">notifications</span>
            {unreadCount > 0 && (
              <span className="absolute end-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 font-bold text-[10px] text-on-error">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {showAlerts && (
            <div className="absolute end-0 top-full z-50 mt-2 w-80 rounded-xl bg-surface-container-lowest shadow-xl ring-1 ring-outline-variant">
              <div className="border-outline-variant border-b px-4 py-3">
                <h3 className="font-bold font-headline text-on-surface text-sm">
                  {t("notifications")}
                </h3>
              </div>
              {alerts.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">
                    notifications_off
                  </span>
                  <p className="mt-2 text-on-surface-variant text-sm">
                    {t("no_alerts")}
                  </p>
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto">
                  {alerts.map((alert) => (
                    <button
                      className="flex w-full items-start gap-3 border-outline-variant border-b px-4 py-3 text-start last:border-b-0 hover:bg-surface-container-high"
                      key={alert.id}
                      onClick={() => markRead(alert.id)}
                      type="button"
                    >
                      <span
                        className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${alert.readAt ? "bg-outline" : "bg-primary"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-body text-on-surface text-sm">
                          {alert.message}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="hidden h-8 w-px bg-outline-variant md:block" />
        <Button
          className="hidden md:flex"
          disabled={!canCreateJob}
          icon="add_circle"
          onClick={() => openIntakeModal()}
          size="sm"
        >
          {t("new_checkin")}
        </Button>
      </div>
    </header>
  );
}
