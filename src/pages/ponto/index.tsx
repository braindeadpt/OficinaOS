import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePontoStore } from "@/stores/ponto";
import ExportTab from "./export-tab";
import HoursTab from "./hours-tab";
import MissingTab from "./missing-tab";
import NowTab from "./now-tab";
import PendingTab from "./pending-tab";
import TeamTab from "./team-tab";

type TabKey =
  | "agora"
  | "validar"
  | "horas"
  | "esquecimentos"
  | "exportar"
  | "equipa";

const TABS: { icon: string; key: TabKey }[] = [
  { icon: "schedule", key: "agora" },
  { icon: "fact_check", key: "validar" },
  { icon: "bar_chart", key: "horas" },
  { icon: "notification_important", key: "esquecimentos" },
  { icon: "download", key: "exportar" },
  { icon: "group", key: "equipa" },
];

export default function PontoPage() {
  const { t } = useTranslation();
  const enabled = usePontoStore((s) => s.enabled);
  const fetchStatus = usePontoStore((s) => s.fetchStatus);
  const [tab, setTab] = useState<TabKey>("agora");

  useEffect(() => {
    if (enabled === null) {
      fetchStatus().catch(() => undefined);
    }
  }, [enabled, fetchStatus]);

  if (enabled === null) {
    return (
      <div className="h-96 animate-pulse rounded-xl bg-surface-container-low" />
    );
  }

  if (!enabled) {
    return (
      <div className="rounded-3xl bg-surface-container-low p-8 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          lock
        </span>
        <h1 className="mt-4 font-black font-headline text-2xl text-on-surface">
          {t("ponto.title")}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-on-surface-variant text-sm">
          {t("ponto.module_inactive")}
        </p>
        <Link
          className="mt-6 inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 font-bold text-on-primary text-sm"
          to="/settings"
        >
          {t("ponto.go_settings")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-black font-headline text-2xl text-on-surface">
          {t("ponto.panel_title")}
        </h1>
        <p className="mt-1 text-on-surface-variant text-sm">
          {t("ponto.panel_subtitle")}
        </p>
      </div>

      <div className="oos-scrollbar -mx-1 flex gap-1 overflow-x-auto rounded-xl bg-surface-container-low p-1">
        {TABS.map(({ icon, key }) => (
          <button
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-4 font-medium text-sm transition-colors ${
              tab === key
                ? "bg-surface-container-lowest text-primary shadow-sm"
                : "text-on-surface-variant hover:text-primary"
            }`}
            key={key}
            onClick={() => setTab(key)}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              {icon}
            </span>
            {t(`ponto.tab_${key}`)}
          </button>
        ))}
      </div>

      {tab === "agora" && <NowTab />}
      {tab === "validar" && <PendingTab />}
      {tab === "horas" && <HoursTab />}
      {tab === "esquecimentos" && <MissingTab />}
      {tab === "exportar" && <ExportTab />}
      {tab === "equipa" && <TeamTab />}
    </div>
  );
}
