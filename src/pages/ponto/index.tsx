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

// Sem o módulo ativo o painel passa a leitura: consulta e exportação
// continuam sempre possíveis (retenção legal de 5 anos), mas validar,
// registar esquecimentos e gerir a equipa são escritas que exigem ponto.
const READONLY_KEYS = new Set<TabKey>([
  "agora",
  "validar",
  "horas",
  "esquecimentos",
  "exportar",
]);

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

      {enabled === false && (
        <div className="flex items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3">
          <span className="material-symbols-outlined text-on-surface-variant">
            lock
          </span>
          <p className="text-on-surface-variant text-sm">
            {t("ponto.readonly_inactive")}
          </p>
          <Link
            className="ml-auto shrink-0 font-bold text-primary text-sm"
            to="/settings"
          >
            {t("ponto.go_settings")}
          </Link>
        </div>
      )}

      <div className="oos-scrollbar -mx-1 flex gap-1 overflow-x-auto rounded-xl bg-surface-container-low p-1">
        {TABS.filter(
          ({ key }) => enabled !== false || READONLY_KEYS.has(key)
        ).map(({ icon, key }) => (
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
