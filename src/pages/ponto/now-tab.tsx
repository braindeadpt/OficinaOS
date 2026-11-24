import type { PontoNowUserDTO } from "@shared/types/ponto";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import { formatClock, TYPE_LABEL, useShopTz } from "./shared";

const STATE_STYLE: Record<PontoNowUserDTO["state"], string> = {
  a_trabalhar: "bg-success/10 text-success",
  em_pausa: "bg-tertiary/15 text-tertiary",
  saiu: "bg-surface-container text-on-surface-variant",
  sem_registo: "bg-surface-container text-on-surface-variant/60",
};

export default function NowTab() {
  const { i18n, t } = useTranslation();
  const shopTz = useShopTz();
  const tz = shopTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [items, setItems] = useState<PontoNowUserDTO[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PontoNowUserDTO[]>("/ponto/now");
      setItems(res.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  if (error) {
    return (
      <div className="rounded-2xl bg-error-container p-4 text-center text-on-error-container text-sm">
        {t("ponto.load_failed")}
        <Button className="ms-3" onClick={load} size="sm" variant="secondary">
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!items) {
    return (
      <div className="h-48 animate-pulse rounded-xl bg-surface-container-low" />
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl bg-surface-container-low p-8 text-center text-on-surface-variant text-sm">
        {t("ponto.now_empty")}
      </div>
    );
  }

  const groups = (["a_trabalhar", "em_pausa", "saiu", "sem_registo"] as const)
    .map((s) => ({ items: items.filter((i) => i.state === s), state: s }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button icon="refresh" onClick={load} size="sm" variant="secondary">
          {t("refresh")}
        </Button>
      </div>
      {groups.map((g) => (
        <section key={g.state}>
          <h2 className="mb-2 font-bold text-on-surface-variant text-xs uppercase tracking-wide">
            {t(`ponto.now_${g.state}`)} ({g.items.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((u) => (
              <div
                className="rounded-2xl bg-surface-container-low p-4"
                key={u.userId}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-bold text-on-surface text-sm">
                    {u.name}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 font-semibold text-xs ${STATE_STYLE[u.state]}`}
                  >
                    {t(`ponto.now_${u.state}`)}
                  </span>
                </div>
                <p className="mt-1.5 text-on-surface-variant text-xs">
                  {u.lastAt
                    ? `${u.lastType ? t(TYPE_LABEL[u.lastType]) : ""} · ${formatClock(u.lastAt, i18n.language, tz)}`
                    : t("ponto.no_entries_today")}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
