import { JobStatus } from "@shared/constants";
import { ACTION_ICONS } from "@shared/constants/action-icons";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";
import api from "@/lib/api";

interface HistoryEntry {
  action: string;
  createdAt: string;
  fromValue?: string | null;
  id: string;
  note?: string | null;
  toValue?: string | null;
  user?: { id: string; name: string; role: string };
}

interface StatusHistoryTimelineProps {
  jobId: string;
}

const STATUS_SET = new Set<string>(Object.values(JobStatus));

function formatValue(
  action: string,
  value: string | null | undefined,
  t: TFunction
): string | null {
  if (!value) {
    return null;
  }
  if (action === "STATUS_CHANGED") {
    return STATUS_SET.has(value)
      ? t(`status.${value}`, { defaultValue: value })
      : value;
  }
  if (action === "TECHNICIAN_ASSIGNED") {
    return value === "unassigned"
      ? t("unassigned", { defaultValue: "Unassigned" })
      : value;
  }
  if (action === "QUOTE_RESPONDED") {
    return t(`quotes.status.${value}`, { defaultValue: value });
  }
  return value;
}

export default function StatusHistoryTimeline({
  jobId,
}: StatusHistoryTimelineProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/jobs/${jobId}/history`);
      setEntries(res.data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Icon
          className="animate-spin text-lg text-on-surface-variant"
          name="progress_activity"
        />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="font-body text-on-surface-variant text-sm">
        {t("jobs_detail_no_history")}
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto pr-1">
      <div className="space-y-0">
        {entries.map((entry, i) => {
          const fromLabel = formatValue(entry.action, entry.fromValue, t);
          const toLabel = formatValue(entry.action, entry.toValue, t);

          return (
            <div className="relative flex gap-3 pb-4" key={entry.id}>
              {i < entries.length - 1 && (
                <div className="absolute start-[15px] top-6 bottom-0 w-px bg-outline-variant" />
              )}
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high">
                <Icon
                  className="text-on-surface-variant text-sm"
                  name={ACTION_ICONS[entry.action] ?? "circle"}
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-body font-medium text-on-surface text-sm">
                    {t(`jobs_history_action_${entry.action}`, {
                      defaultValue: entry.action,
                    })}
                  </span>
                  {fromLabel && toLabel && (
                    <span className="font-body text-on-surface-variant text-xs">
                      {fromLabel} → {toLabel}
                    </span>
                  )}
                  {!fromLabel && toLabel && (
                    <span className="font-body text-on-surface-variant text-xs">
                      → {toLabel}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="font-label text-on-surface-variant text-xs">
                    {entry.user?.name}
                  </span>
                  <span className="font-label text-on-surface-variant/60 text-xs">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </div>
                {entry.note && (
                  <p className="mt-1 font-body text-on-surface-variant text-xs italic">
                    {entry.note}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
