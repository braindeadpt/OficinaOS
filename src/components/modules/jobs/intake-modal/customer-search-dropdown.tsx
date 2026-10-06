import { Icon } from "@/components/ui/icon";
import type { CustomerSearchResult } from "@/hooks/use-customer-search";

interface SearchDropdownProps {
  isSearching: boolean;
  onCreateNew: () => void;
  onSelect: (c: CustomerSearchResult) => void;
  query: string;
  results: CustomerSearchResult[];
  searchError: boolean;
  t: (key: string) => string;
  visible: boolean;
}

export default function CustomerSearchDropdown({
  isSearching,
  onCreateNew,
  onSelect,
  query,
  results,
  searchError,
  t,
  visible,
}: SearchDropdownProps) {
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
            {t("intake.error_search_customer")}
          </span>
        </div>
      )}
      {!isSearching && results.length > 0 && !searchError && (
        <ul className="max-h-48 overflow-y-auto py-1">
          {results.map((c) => (
            <li key={c.id}>
              <button
                className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-container-high"
                onClick={() => onSelect(c)}
                type="button"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container">
                  <Icon
                    className="text-on-primary-container text-sm"
                    name="person"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold font-headline text-on-surface text-sm">
                    {c.name}
                  </p>
                  <p className="truncate font-label text-on-surface-variant text-xs">
                    {c.phone}
                    {c.email ? ` · ${c.email}` : ""}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isSearching &&
        results.length === 0 &&
        !searchError &&
        query.length >= 2 && (
          <div className="flex items-center gap-2 px-4 py-3">
            <Icon
              className="text-on-surface-variant text-sm"
              name="person_add"
            />
            <span className="font-label text-on-surface-variant text-xs">
              {t("intake.no_customer_found")}
            </span>
            <button
              className="ms-auto font-bold font-headline text-primary text-xs hover:underline"
              onClick={onCreateNew}
              type="button"
            >
              {t("intake.create_new")}
            </button>
          </div>
        )}
    </div>
  );
}
