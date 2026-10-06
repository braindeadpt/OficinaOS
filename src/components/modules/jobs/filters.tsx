import type { JobStatusType } from "@shared/constants";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";
import type { StatusGroupKey } from "./jobs-shared";
import { STATUS_GROUPS } from "./jobs-shared";

interface UnifiedJobsFilterProps {
  activeGroup: StatusGroupKey | "ALL";
  activeStatus: JobStatusType | "ALL";
  metrics: Record<string, number> | null;
  onGroupChange: (group: StatusGroupKey | "ALL") => void;
  onSearchChange: (query: string) => void;
  onStatusChange: (status: JobStatusType | "ALL") => void;
  searchQuery: string;
}

export default function UnifiedJobsFilter({
  activeGroup,
  activeStatus,
  metrics,
  onGroupChange,
  onStatusChange,
  onSearchChange,
  searchQuery,
}: UnifiedJobsFilterProps) {
  const { t } = useTranslation();

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const group of STATUS_GROUPS) {
      counts[group.key] = group.statuses.reduce(
        (sum, s) => sum + (metrics?.[s] ?? 0),
        0
      );
    }
    counts.ALL = Object.values(metrics ?? {}).reduce((a, b) => a + b, 0);
    return counts;
  }, [metrics]);

  const activeSubStatuses =
    activeGroup === "ALL"
      ? []
      : (STATUS_GROUPS.find((g) => g.key === activeGroup)?.statuses ?? []);

  const pillBase =
    "min-h-[44px] shrink-0 rounded-lg px-3 py-2 font-bold font-label text-xs uppercase tracking-wider transition-all";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="relative w-full sm:w-64 sm:shrink-0">
          <Icon
            className="absolute start-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm"
            name="search"
          />
          <input
            aria-label={t("search")}
            className="min-h-[44px] w-full rounded-lg bg-surface-container-low py-2 ps-10 pe-3 font-body text-on-surface text-sm transition-all placeholder:text-outline focus:bg-surface-container-lowest"
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("search_jobs")}
            type="search"
            value={searchQuery}
          />
        </div>
        <div
          className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <button
            className={[
              pillBase,
              activeGroup === "ALL" && activeStatus === "ALL"
                ? "bg-primary text-on-primary"
                : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
            ].join(" ")}
            onClick={() => onGroupChange("ALL")}
            type="button"
          >
            {t("status_label")} ({groupCounts.ALL})
          </button>

          {STATUS_GROUPS.map((group) => (
            <button
              className={[
                pillBase,
                activeGroup === group.key && activeStatus === "ALL"
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
              ].join(" ")}
              key={group.key}
              onClick={() => onGroupChange(group.key)}
              type="button"
            >
              {t(group.labelKey)} ({groupCounts[group.key]})
            </button>
          ))}

          {activeGroup !== "ALL" && (
            <div className="col-span-2 flex flex-wrap gap-2 rounded-2xl bg-surface-container-low p-2 sm:ms-1 sm:w-full lg:w-auto">
              {activeSubStatuses.map((s) => (
                <button
                  className={[
                    pillBase,
                    activeStatus === s
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container",
                  ].join(" ")}
                  key={s}
                  onClick={() => onStatusChange(s)}
                  type="button"
                >
                  {t(`status.${s}`)} {metrics?.[s] ?? 0}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
