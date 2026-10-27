import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import ClaimsFilters from "@/components/modules/returns/claims-filters";
import ClaimsTable from "@/components/modules/returns/claims-table";
import { Icon } from "@/components/ui/icon";
import { fetchReturnClaims } from "@/lib/api-return-claims";
import type {
  ListClaimsParams,
  ListClaimsResponse,
} from "@/types/return-claim";

export default function ReturnsListPage() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ListClaimsParams>({
    status: "OPEN",
    page: 1,
    limit: 20,
  });
  const [data, setData] = useState<ListClaimsResponse | null>(null);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchReturnClaims(filters);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const isEmpty = !isLoading && (!data || data.items.length === 0);
  const hasActiveFilters = Object.entries(filters).some(
    ([key, value]) => key !== "page" && key !== "limit" && value !== undefined
  );

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("returns_list_title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("returns_list_subtitle")}
          </p>
        </div>
      </div>

      {!isEmpty && <ClaimsFilters onChange={setFilters} value={filters} />}

      {isEmpty && (
        <div
          className="flex flex-col items-center justify-center py-16"
          role="status"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-low">
            <Icon
              className="text-on-surface-variant"
              name="assignment_return"
              size="xl"
            />
          </div>
          <p className="font-bold font-headline text-lg text-on-surface">
            {t(
              hasActiveFilters
                ? "returns_list_empty_filtered_title"
                : "returns_list_empty_title"
            )}
          </p>
          <p className="mt-1 max-w-md text-center text-on-surface-variant text-sm">
            {t(
              hasActiveFilters
                ? "returns_list_empty_filtered_desc"
                : "returns_list_empty_desc"
            )}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 font-bold text-on-primary text-sm transition-opacity hover:opacity-90"
              to="/jobs?status=DELIVERED"
            >
              {t("returns_empty_cta")}
            </Link>
            {hasActiveFilters && (
              <button
                className="min-h-11 rounded-xl bg-surface-container-high px-5 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
                onClick={() =>
                  setFilters({ status: undefined, page: 1, limit: 20 })
                }
                type="button"
              >
                {t("returns_filter_clear")}
              </button>
            )}
          </div>
        </div>
      )}

      {!isEmpty && data && (
        <ClaimsTable
          isLoading={isLoading}
          items={data.items}
          limit={filters.limit ?? 20}
          onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
          page={filters.page ?? 1}
          total={data.total}
        />
      )}
    </>
  );
}
