import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import AddCustomerModal from "@/components/modules/customers/add-customer-modal";
import ConsentToggle from "@/components/modules/customers/consent-toggle";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { downloadCsv } from "@/lib/export-csv";
import { useCustomersStore } from "@/stores/customers";

function SkeletonRow() {
  return (
    <tr>
      <td className="px-5 py-4">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-2/5 animate-pulse rounded bg-surface-container-high" />
          <div className="h-2 w-3/5 animate-pulse rounded bg-surface-container-highest" />
        </div>
      </td>
      <td className="hidden px-5 py-4 sm:table-cell">
        <div className="h-3 w-2/5 animate-pulse rounded bg-surface-container-high" />
      </td>
      <td className="hidden px-5 py-4 md:table-cell">
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-container-high" />
      </td>
      <td className="hidden px-5 py-4 lg:table-cell">
        <div className="h-5 w-12 animate-pulse rounded-full bg-surface-container-high" />
      </td>
      <td className="px-5 py-4">
        <div className="h-5 w-12 animate-pulse rounded-full bg-surface-container-high" />
      </td>
    </tr>
  );
}

function DesktopCustomersTable({
  customers,
  isLoading,
  t,
}: {
  customers: {
    _count?: { jobs: number };
    email: string | null;
    id: string;
    name: string;
    phone: string;
    whatsappConsent?: boolean;
    whatsappConsentAt?: string | null;
  }[];
  isLoading: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const thCls =
    "px-5 py-4 font-bold text-on-surface-variant text-xs uppercase tracking-wide text-start";

  return (
    <table className="w-full min-w-[540px] border-collapse text-start">
      <thead>
        <tr className="bg-surface-container-high/50">
          <th className={thCls}>{t("customer")}</th>
          <th className={`${thCls} hidden sm:table-cell`}>
            {t("customer_phone")}
          </th>
          <th className={`${thCls} hidden md:table-cell`}>
            {t("customer_email")}
          </th>
          <th className={`${thCls} hidden lg:table-cell`}>
            {t("customer_consent_column")}
          </th>
          <th className={thCls}>{t("jobs")}</th>
        </tr>
      </thead>
      <tbody>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={`skeleton-${String(i)}`} />
            ))
          : customers.map((c) => (
              <tr
                className="transition-colors hover:bg-surface-container-lowest"
                key={c.id}
              >
                <td className="px-5 py-4">
                  <Link
                    className="font-bold text-on-surface text-sm hover:underline"
                    to={`/customers/${c.id}`}
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="hidden px-5 py-4 sm:table-cell">
                  <span className="font-mono text-on-surface-variant text-sm">
                    {c.phone}
                  </span>
                </td>
                <td className="hidden px-5 py-4 md:table-cell">
                  <span className="text-on-surface-variant text-sm">
                    {c.email ?? "\u2014"}
                  </span>
                </td>
                <td className="hidden px-5 py-4 lg:table-cell">
                  <ConsentToggle customer={c} />
                </td>
                <td className="px-5 py-4">
                  <span className="rounded-full bg-primary-container px-2.5 py-1 font-bold font-mono text-on-primary-container text-xs">
                    {c._count?.jobs ?? 0}
                  </span>
                </td>
              </tr>
            ))}
      </tbody>
    </table>
  );
}

function MobileCustomerCard({
  customer,
  t,
}: {
  customer: {
    _count?: { jobs: number };
    id: string;
    name: string;
    phone: string;
    whatsappConsent?: boolean;
    whatsappConsentAt?: string | null;
  };
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface-container-lowest p-4">
      <Link
        className="min-w-0 flex-1 transition-colors hover:opacity-80"
        to={`/customers/${customer.id}`}
      >
        <p className="font-bold text-on-surface text-sm">{customer.name}</p>
        <p className="font-mono text-on-surface-variant text-xs">
          {customer.phone}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        <ConsentToggle customer={customer} />
        <Link
          className="flex items-center gap-2"
          to={`/customers/${customer.id}`}
        >
          <span className="rounded-full bg-primary-container px-2.5 py-1 font-bold text-on-primary-container text-xs">
            {t("job_count", { count: customer._count?.jobs ?? 0 })}
          </span>
          <Icon
            className="text-on-surface-variant"
            name="chevron_right"
            size="sm"
          />
        </Link>
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [consentFilter, setConsentFilter] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const debouncedSearch = useDebounce(search, 300);
  const {
    customers,
    isLoading,
    totalCount,
    fetchCustomers,
    exportCustomersCsv,
    isExporting,
  } = useCustomersStore();

  useEffect(() => {
    fetchCustomers(
      debouncedSearch.trim() || undefined,
      consentFilter || undefined
    );
  }, [debouncedSearch, consentFilter, fetchCustomers]);

  // Export mirrors the visible list: same search + consent filters, but
  // walks every page so campaign/audit exports cover the full directory.
  const handleExportCsv = useCallback(async () => {
    try {
      const rows = await exportCustomersCsv(
        debouncedSearch.trim() || undefined,
        consentFilter || undefined
      );
      const stamp = new Date().toISOString().slice(0, 10);
      const consentSlug = consentFilter || "all";
      downloadCsv(
        `customers-${consentSlug}-${stamp}.csv`,
        [
          t("customers_export_name"),
          t("customer_phone"),
          t("customer_email"),
          t("customer_consent_column"),
          t("customers_export_optin_since"),
          t("jobs"),
        ],
        rows.map((c) => [
          c.name,
          c.phone,
          c.email,
          c.whatsappConsent ? t("yes") : t("no"),
          c.whatsappConsentAt
            ? new Date(c.whatsappConsentAt).toISOString()
            : null,
          c._count?.jobs ?? 0,
        ])
      );
      toast.success(t("customers_export_done"));
    } catch {
      toast.error(t("customers_export_failed"));
    }
  }, [consentFilter, debouncedSearch, exportCustomersCsv, t]);

  const customersWithJobs = useMemo(
    () => customers.filter((c) => (c._count?.jobs ?? 0) > 0).length,
    [customers]
  );

  const hasCustomers = customers.length > 0 || isLoading;
  const showSearchEmpty =
    customers.length === 0 &&
    !isLoading &&
    (search !== "" || consentFilter !== "");
  const showEmptyCatalog =
    totalCount === 0 && !isLoading && search === "" && consentFilter === "";

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("customers")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("customers_desc")}
          </p>
        </div>
        <Button
          icon="add"
          onClick={() => setShowAddModal(true)}
          size="md"
          type="button"
          variant="primary-gradient"
        >
          {t("add_customer")}
        </Button>
      </div>

      {!showEmptyCatalog && (
        <section aria-label={t("customers")}>
          <h3 className="sr-only">{t("customers")}</h3>
          <div className="mb-6 grid gap-4 sm:grid-cols-[1.5fr_1fr]">
            <div className="rounded-2xl bg-surface-container-low p-5">
              <p className="font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("total_customers")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-4xl text-on-surface">
                {totalCount}
              </p>
            </div>
            <div className="rounded-2xl bg-surface-container p-5">
              <p className="font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("customers_with_jobs")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-2xl text-on-surface">
                {customersWithJobs}
              </p>
            </div>
          </div>
        </section>
      )}

      {!showEmptyCatalog && (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input
              iconStart="search"
              id="customers-search"
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search_customers_placeholder")}
              value={search}
            />
          </div>
          <div className="sm:w-56">
            <Select
              aria-label={t("customers_consent_filter")}
              id="customers-consent-filter"
              onChange={(e) => setConsentFilter(e.target.value)}
              value={consentFilter}
            >
              <option value="">{t("customers_consent_all")}</option>
              <option value="true">{t("customers_consent_opted_in")}</option>
              <option value="false">{t("customers_consent_opted_out")}</option>
            </Select>
          </div>
          <Button
            aria-label={t("customers_export")}
            icon="download"
            loading={isExporting}
            onClick={handleExportCsv}
            size="md"
            variant="secondary"
          >
            {t("customers_export")}
          </Button>
        </div>
      )}

      {showSearchEmpty && (
        <div
          className="flex flex-col items-center justify-center py-16"
          role="status"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-low">
            <Icon
              className="text-on-surface-variant"
              name="search_off"
              size="xl"
            />
          </div>
          <p className="font-bold font-headline text-lg text-on-surface">
            {t("no_customers_found")}
          </p>
          <p className="mt-1 text-on-surface-variant text-sm">
            {t("no_customers_found_desc")}
          </p>
          <button
            className="mt-5 min-h-11 rounded-xl bg-surface-container-high px-5 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
            onClick={() => {
              setSearch("");
              setConsentFilter("");
            }}
            type="button"
          >
            {t("clear_filters")}
          </button>
        </div>
      )}

      {hasCustomers && (
        <div className="overflow-hidden rounded-2xl bg-surface-container-low">
          <div className="hidden overflow-x-auto md:block">
            <DesktopCustomersTable
              customers={customers}
              isLoading={isLoading}
              t={t}
            />
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div
                    className="flex flex-col gap-3 rounded-xl p-4"
                    key={`mobile-skeleton-${String(i)}`}
                  >
                    <div className="h-3 w-3/5 animate-pulse rounded bg-surface-container-high" />
                    <div className="h-2 w-2/5 animate-pulse rounded bg-surface-container-highest" />
                  </div>
                ))
              : customers.map((c) => (
                  <MobileCustomerCard customer={c} key={c.id} t={t} />
                ))}
          </div>
        </div>
      )}

      <AddCustomerModal
        onClose={() => setShowAddModal(false)}
        onSuccess={() => {
          fetchCustomers(
            debouncedSearch.trim() || undefined,
            consentFilter || undefined
          );
        }}
        open={showAddModal}
      />
    </>
  );
}
