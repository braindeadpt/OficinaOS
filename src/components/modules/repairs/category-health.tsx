import type { RepairCategoryType } from "@shared/constants";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { REPAIR_CATEGORY_BAR_COLORS } from "@/lib/category-display";
import type { RepairItem } from "./repair-table";

const FALLBACK_CATEGORIES: { key: RepairCategoryType; pct: number }[] = [
  { key: "HARDWARE", pct: 65 },
  { key: "SOFTWARE", pct: 20 },
  { key: "DIAGNOSTIC", pct: 15 },
];

interface CategoryHealthProps {
  repairs?: RepairItem[];
}

export default function CategoryHealth({ repairs }: CategoryHealthProps) {
  const { t } = useTranslation();

  const categories = useMemo(() => {
    if (!repairs) {
      return FALLBACK_CATEGORIES;
    }
    const total = repairs.length;
    if (total === 0) {
      return FALLBACK_CATEGORIES;
    }
    const counts: Record<string, number> = {};
    for (const r of repairs) {
      counts[r.category] = (counts[r.category] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([key, count]) => ({
        key: key as RepairCategoryType,
        pct: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [repairs]);

  return (
    <div className="rounded-2xl bg-surface-container-high p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="font-extrabold font-headline text-lg text-on-surface">
          {t("service_breakdown")}
        </h3>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-on-surface-variant"
        >
          stacked_bar_chart
        </span>
      </div>
      <div className="flex flex-col gap-4">
        {categories.map((cat) => (
          <div key={cat.key}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium text-on-surface text-sm">
                {t(`repair_category.${cat.key}`)}
              </span>
              <span className="font-semibold text-on-surface-variant text-xs">
                {cat.pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className={`h-full rounded-full ${REPAIR_CATEGORY_BAR_COLORS[cat.key]} transition-all duration-700`}
                style={{ width: `${cat.pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        aria-disabled="true"
        className="mt-6 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-surface-container-highest px-4 py-3 font-headline font-medium text-on-surface-variant text-xs uppercase tracking-wider opacity-50 transition-all"
        disabled
        type="button"
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px]"
        >
          download
        </span>
        {t("download_service_report")}
        <span className="rounded-full bg-on-surface-variant/15 px-2 py-0.5 font-medium text-[10px] text-on-surface-variant uppercase tracking-wide">
          {t("coming_soon")}
        </span>
      </button>
    </div>
  );
}
