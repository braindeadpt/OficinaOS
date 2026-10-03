import type { JobStatusType } from "@shared/constants";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BatchActionBar from "@/components/modules/jobs/batch-action-bar";
import UnifiedJobsFilter from "@/components/modules/jobs/filters";
import type {
  JobRow,
  StatusGroupKey,
} from "@/components/modules/jobs/jobs-shared";
import { jobToRow, STATUS_GROUPS } from "@/components/modules/jobs/jobs-shared";
import JobsTable from "@/components/modules/jobs/jobs-table";
import JobMobileCard from "@/components/modules/jobs/mobile-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { exportJobsPdf } from "@/lib/export-pdf";
import { useJobsStore } from "@/stores/jobs";
import { useUiStore } from "@/stores/ui";

export default function JobsPage() {
  const { t } = useTranslation();
  const { jobs, metrics, isLoadingJobs, fetchJobs, fetchMetrics } =
    useJobsStore();
  const [statusFilter, setStatusFilter] = useState<JobStatusType | "ALL">(
    "ALL"
  );
  const [groupFilter, setGroupFilter] = useState<StatusGroupKey | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);

  useEffect(() => {
    fetchJobs();
    fetchMetrics();
  }, [fetchJobs, fetchMetrics]);

  const jobRows: JobRow[] = useMemo(() => jobs.map(jobToRow), [jobs]);

  const filteredJobs = useMemo(() => {
    let result = jobRows;

    if (statusFilter !== "ALL") {
      result = result.filter((j) => j.status === statusFilter);
    } else if (groupFilter !== "ALL") {
      const group = STATUS_GROUPS.find((g) => g.key === groupFilter);
      if (group) {
        result = result.filter((j) => group.statuses.includes(j.status));
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (j) =>
          j.id.toLowerCase().includes(q) ||
          j.customer.toLowerCase().includes(q) ||
          j.device.toLowerCase().includes(q) ||
          (j.imei ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [jobRows, statusFilter, groupFilter, searchQuery]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((jobId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (filteredJobs.every((j) => prev.has(j.rawJob?.id ?? j.id))) {
        return new Set();
      }
      return new Set(filteredJobs.map((j) => j.rawJob?.id ?? j.id));
    });
  }, [filteredJobs]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedJobs = useMemo(
    () =>
      filteredJobs
        .filter((j) => selectedIds.has(j.rawJob?.id ?? j.id))
        .map((j) => ({ id: j.rawJob?.id ?? j.id, status: j.status })),
    [filteredJobs, selectedIds]
  );

  const handleGroupChange = (group: StatusGroupKey | "ALL") => {
    setGroupFilter(group);
    setStatusFilter("ALL");
  };

  const clearFilters = useCallback(() => {
    setGroupFilter("ALL");
    setStatusFilter("ALL");
    setSearchQuery("");
  }, []);

  const handleExport = useCallback(async () => {
    await exportJobsPdf({
      columns: [
        { key: "id", label: t("job_id") },
        { key: "customer", label: t("customer") },
        { key: "device", label: t("device") },
        { key: "status", label: t("status_label") },
        { key: "technician", label: t("technician") },
      ],
      rows: filteredJobs,
      title: t("open_repairs"),
      filename: "jobs.pdf",
    });
  }, [filteredJobs, t]);

  if (isLoadingJobs && jobs.length === 0) {
    return (
      <>
        <div className="mb-6">
          <div className="h-8 w-56 animate-pulse rounded-lg bg-surface-container-high" />
          <div className="mt-2 h-5 w-72 animate-pulse rounded-lg bg-surface-container-high" />
        </div>
        <TableSkeleton columns={6} rows={8} />
      </>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("open_repairs")}
          </h2>
          <p className="mt-1 font-body font-medium text-on-surface-variant text-sm md:text-base">
            {t("open_repairs_desc")}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <Button
            aria-label={t("download_list")}
            className="flex-1 sm:flex-none"
            icon="file_export"
            onClick={handleExport}
            size="md"
            variant="secondary"
          >
            {t("download_list")}
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            icon="add_box"
            onClick={() => openIntakeModal()}
            size="md"
          >
            {t("new_checkin")}
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <UnifiedJobsFilter
          activeGroup={groupFilter}
          activeStatus={statusFilter}
          metrics={metrics}
          onGroupChange={handleGroupChange}
          onSearchChange={setSearchQuery}
          onStatusChange={setStatusFilter}
          searchQuery={searchQuery}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-container-low px-4 py-3">
          <p className="font-bold text-on-surface-variant text-sm">
            {t("showing_results", {
              count: filteredJobs.length,
              total: jobRows.length,
            })}
          </p>
          {(searchQuery || groupFilter !== "ALL" || statusFilter !== "ALL") && (
            <Button
              className="min-h-11"
              onClick={clearFilters}
              size="sm"
              variant="ghost"
            >
              {t("clear_filters")}
            </Button>
          )}
        </div>

        <div className="hidden sm:block">
          <JobsTable
            jobs={filteredJobs}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            selectedIds={selectedIds}
          />
        </div>

        <div className="space-y-3 sm:hidden">
          {filteredJobs.map((job) => (
            <JobMobileCard
              customer={job.customer}
              customerTier={job.customerTier}
              device={job.device}
              deviceIcon={job.deviceIcon}
              id={job.id}
              key={job.id}
              rawJob={job.rawJob}
              status={job.status}
            />
          ))}
        </div>

        {filteredJobs.length === 0 && (
          <EmptyState
            action={
              <>
                <Button
                  className="min-h-11"
                  onClick={clearFilters}
                  size="sm"
                  variant="ghost"
                >
                  {t("clear_filters")}
                </Button>
                <Button
                  className="min-h-11"
                  onClick={() => openIntakeModal()}
                  size="sm"
                >
                  {t("new_checkin")}
                </Button>
              </>
            }
            description={`${t("no_jobs_found_desc")}${
              searchQuery || groupFilter !== "ALL" || statusFilter !== "ALL"
                ? ` ${t("active_filters_summary", {
                    group: groupFilter === "ALL" ? "" : t(groupFilter),
                    search: searchQuery ?? "",
                    status:
                      statusFilter === "ALL" ? "" : t(`status.${statusFilter}`),
                  })}`
                : ""
            }`}
            icon="search_off"
            title={t("no_jobs_found")}
          />
        )}
      </section>

      <BatchActionBar
        onClear={clearSelection}
        selectedIds={selectedIds}
        selectedJobs={selectedJobs}
      />
    </>
  );
}
