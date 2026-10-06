import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useCan } from "@/hooks/use-can";
import { useShortcutLabel } from "@/hooks/use-shortcut-label";
import { useWs } from "@/hooks/use-ws";
import { useAlertsStore } from "@/stores/alerts";
import { useCommandPaletteStore } from "@/stores/command-palette";
import { useUiStore } from "@/stores/ui";
import ReportProblemModal from "./feedback/report-problem-modal";
import LanguageToggle from "./language-toggle";

export default function TopBar() {
  const { t } = useTranslation();
  const [showAlerts, setShowAlerts] = useState(false);
  const canCreateJob = useCan({ jobs: ["create"] });
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);
  const reportModalOpen = useUiStore((s) => s.reportModalOpen);
  const openReportModal = useUiStore((s) => s.openReportModal);
  const closeReportModal = useUiStore((s) => s.closeReportModal);
  const openCommandPalette = useCommandPaletteStore((s) => s.open);
  const shortcutLabel = useShortcutLabel();
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
    <>
      <header className="fixed start-0 top-0 z-40 flex h-16 w-full items-center justify-between border-outline-variant border-b bg-surface/95 px-4 shadow-sm backdrop-blur-sm md:px-8 lg:start-64 lg:w-[calc(100%-16rem)]">
        <div className="flex flex-1 items-center gap-4">
          <div className="flex items-center gap-2 lg:hidden">
            <img
              alt=""
              aria-hidden="true"
              className="h-6 w-6"
              height={24}
              src="/logo-mark.svg"
              width={24}
            />
            <span className="font-black font-headline text-on-surface text-sm uppercase tracking-tighter">
              OficinaOS
            </span>
          </div>
          <button
            aria-label={t("command_palette.open")}
            className="group flex min-h-11 w-full max-w-xs items-center gap-2 rounded-full bg-surface-container-high px-3 text-on-surface-variant transition-colors hover:bg-surface-container-highest md:w-96"
            onClick={openCommandPalette}
            type="button"
          >
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-lg"
            >
              search
            </span>
            <span className="min-w-0 flex-1 truncate text-start text-sm">
              {t("command_palette.placeholder")}
            </span>
            <kbd className="pointer-events-none hidden shrink-0 rounded-md bg-surface-container-highest px-1.5 py-0.5 font-mono text-[10px] tracking-wide group-focus-within:hidden md:block">
              {shortcutLabel}
            </kbd>
          </button>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button
            aria-label={t("report_problem.title")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            onClick={openReportModal}
            title={t("report_problem.title")}
            type="button"
          >
            <span className="material-symbols-outlined">bug_report</span>
          </button>
          <LanguageToggle />
          <div className="relative" ref={dropdownRef}>
            <button
              aria-label={t("notifications")}
              className="relative flex min-h-11 min-w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
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
      {/* Rendered outside <header> — its backdrop-filter would trap the
          modal's position:fixed inside the header box. */}
      <ReportProblemModal onClose={closeReportModal} open={reportModalOpen} />
    </>
  );
}
