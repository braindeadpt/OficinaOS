import { Icon } from "@/components/ui/icon";
import type { BrandSearchResult } from "@/hooks/use-brand-search";

interface BrandSearchDropdownProps {
  isCreating: boolean;
  isSearching: boolean;
  onAdd: () => void;
  onSelect: (brand: BrandSearchResult) => void;
  query: string;
  results: BrandSearchResult[];
  searchError: boolean;
  showAddOption: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  visible: boolean;
}

export default function BrandSearchDropdown({
  isCreating,
  isSearching,
  onAdd,
  onSelect,
  query,
  results,
  searchError,
  showAddOption,
  t,
  visible,
}: BrandSearchDropdownProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl bg-surface-container-lowest shadow-lg ring-1 ring-outline-variant">
      {isSearching && !searchError && (
        <div className="flex items-center gap-2 px-4 py-3">
          <Icon
            className="animate-spin text-on-surface-variant text-sm"
            name="progress_activity"
          />
          <span className="font-label text-on-surface-variant text-xs">
            {t("intake.searching")}
          </span>
        </div>
      )}
      {searchError && (
        <div className="flex items-center gap-2 px-4 py-3">
          <Icon className="text-error text-sm" name="error" />
          <span className="font-label text-error text-xs">
            {t("intake.error_search_brand")}
          </span>
        </div>
      )}
      {!isSearching && results.length > 0 && !searchError && (
        <div
          aria-label={t("intake.brand_search_placeholder")}
          className="max-h-[11rem] overflow-y-auto py-1"
          role="listbox"
        >
          {results.map((b) => (
            <div key={b.id}>
              <button
                aria-selected={false}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-container-high"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(b);
                }}
                role="option"
                type="button"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container">
                  <Icon
                    className="text-on-primary-container text-sm"
                    name="smartphone"
                  />
                </span>
                <span className="truncate font-bold font-headline text-on-surface text-sm">
                  {b.name}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      {showAddOption && !isSearching && !searchError && !isCreating && (
        <button
          className="flex w-full items-center gap-3 border-outline-variant border-t px-4 py-2.5 text-start transition-colors hover:bg-surface-container-high"
          onMouseDown={(e) => {
            e.preventDefault();
            onAdd();
          }}
          type="button"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tertiary-container">
            <Icon className="text-on-tertiary-container text-sm" name="add" />
          </span>
          <span className="truncate font-bold font-headline text-primary text-sm">
            {t("intake.add_brand", { name: query })}
          </span>
        </button>
      )}
      {isCreating && (
        <div className="flex items-center gap-2 border-outline-variant border-t px-4 py-3">
          <Icon
            className="animate-spin text-on-surface-variant text-sm"
            name="progress_activity"
          />
          <span className="font-label text-on-surface-variant text-xs">
            {t("intake.creating_brand")}
          </span>
        </div>
      )}
      {!isSearching &&
        results.length === 0 &&
        !searchError &&
        !showAddOption &&
        query.length >= 1 && (
          <div className="flex items-center gap-2 px-4 py-3">
            <Icon
              className="text-on-surface-variant text-sm"
              name="search_off"
            />
            <span className="font-label text-on-surface-variant text-xs">
              {t("intake.no_brand_found")}
            </span>
          </div>
        )}
    </div>
  );
}
