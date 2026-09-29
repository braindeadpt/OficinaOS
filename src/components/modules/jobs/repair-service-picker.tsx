import type { RepairCatalog } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { useRepairCatalogStore } from "@/stores/repair-catalog";

interface RepairServicePickerProps {
  compact?: boolean;
  onSelect: (repair: RepairCatalog) => void;
  selectedIds: string[];
}

export default function RepairServicePicker({
  onSelect,
  selectedIds,
  compact = false,
}: RepairServicePickerProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { repairs, fetchRepairs, isLoading } = useRepairCatalogStore();

  useEffect(() => {
    if (repairs.length === 0) {
      fetchRepairs({ isActive: true, limit: 100 });
    }
  }, [fetchRepairs, repairs.length]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return repairs;
    }
    const q = query.toLowerCase();
    return repairs.filter((r) => r.name.toLowerCase().includes(q));
  }, [repairs, query]);

  const handleSelect = useCallback(
    (repair: RepairCatalog) => {
      onSelect(repair);
      setQuery("");
      setOpen(false);
    },
    [onSelect]
  );

  return (
    <div className={compact ? "space-y-2" : "space-y-3"} ref={containerRef}>
      <div className="relative">
        <span className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-outline text-sm">
          search
        </span>
        <input
          className="h-11 w-full rounded-xl bg-surface-container-highest ps-9 pe-4 font-body text-on-surface text-sm outline-none transition-all placeholder:text-outline focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("intake.search_repairs")}
          type="text"
          value={query}
        />

        {open && (
          <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl bg-surface-container-lowest shadow-lg ring-1 ring-outline-variant">
            {isLoading && (
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="material-symbols-outlined animate-spin text-on-surface-variant text-sm">
                  progress_activity
                </span>
                <span className="font-label text-on-surface-variant text-xs">
                  {t("intake.searching")}
                </span>
              </div>
            )}
            {!isLoading && filtered.length > 0 && (
              <ul className="max-h-48 overflow-y-auto py-1">
                {filtered.map((r) => {
                  const alreadySelected = selectedIds.includes(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors ${
                          alreadySelected
                            ? "cursor-not-allowed opacity-40"
                            : "hover:bg-surface-container-high"
                        }`}
                        disabled={alreadySelected}
                        onClick={() => handleSelect(r)}
                        type="button"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-bold font-headline text-on-surface text-sm">
                            {r.name}
                          </p>
                          <p className="font-label text-on-surface-variant text-xs">
                            {t(`repair_category.${r.category}`)} ·{" "}
                            {fmt(Number(r.defaultPrice))}
                          </p>
                        </div>
                        {alreadySelected && (
                          <span className="material-symbols-outlined text-primary text-sm">
                            check
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {!isLoading &&
              filtered.length === 0 &&
              query.trim().length >= 1 && (
                <div className="px-4 py-3">
                  <span className="font-label text-on-surface-variant text-xs">
                    {t("intake.no_repairs_found")}
                  </span>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
