import type { Customer, Job } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Can } from "@/components/modules/can";
import EditCustomerDialog from "@/components/modules/customers/edit-customer-dialog";
import CostSummary from "@/components/modules/jobs/cost-summary";
import JobIntakeChips from "@/components/modules/jobs/job-intake-chips";
import JobNotesSection from "@/components/modules/jobs/job-notes-section";
import JobPartsSection from "@/components/modules/jobs/job-parts-section";
import JobPaymentsSection from "@/components/modules/jobs/job-payments-section";
import JobPhotosSection from "@/components/modules/jobs/job-photos-section";
import JobPortalLink from "@/components/modules/jobs/job-portal-link";
import JobQuotesSection from "@/components/modules/jobs/job-quotes-section";
import JobRepairsSection from "@/components/modules/jobs/job-repairs-section";
import JobReturnsHistorySection from "@/components/modules/jobs/job-returns-history-section";
import JobWaitingPartsSection from "@/components/modules/jobs/job-waiting-parts-section";
import StatusHistoryTimeline from "@/components/modules/jobs/status-history-timeline";
import StatusPopover from "@/components/modules/jobs/status-popover";
import TechnicianSelect from "@/components/modules/jobs/technician-select";
import CreateWizardModal from "@/components/modules/returns/create-wizard-modal";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { useJobsStore } from "@/stores/jobs";
import { useSettingsStore } from "@/stores/settings";

function toNum(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [showReturnWizard, setShowReturnWizard] = useState(false);
  const navigate = useNavigate();

  const fetchJob = useCallback(async () => {
    if (!id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await useJobsStore.getState().fetchJobById(id);
      setJob(data);
      useJobsStore
        .getState()
        .fetchNotes(id)
        .catch(() => {
          /* non-critical */
        });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : t("jobs_detail_load_error")
      );
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  const handleCopyTrackLink = useCallback(() => {
    if (!job?.jobCode) {
      return;
    }
    const url = `${window.location.origin}/tracking/${job.jobCode}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success(t("jobs_detail_track_link_copied")),
      (err) => console.error("Failed to copy tracking link:", err)
    );
  }, [job?.jobCode, t]);

  const portalPublished = Boolean(job?.portalPublishedAt);

  const handleCustomerSaved = useCallback(
    (updated: Customer) => {
      if (job?.customer) {
        setJob({ ...job, customer: updated });
      }
    },
    [job]
  );

  const wizardJob = useMemo(() => {
    if (!job || job.status !== "DELIVERED") {
      return null;
    }
    const deliveredAt =
      job.status === "DELIVERED" ? new Date(job.updatedAt) : null;
    const daysSince = deliveredAt
      ? Math.floor((Date.now() - deliveredAt.getTime()) / 86_400_000)
      : null;
    const defaultWarranty =
      useSettingsStore.getState().shopSettings?.defaultWarrantyDays ?? 0;

    return {
      customer: { id: job.customer?.id ?? "", name: job.customer?.name ?? "" },
      id: job.id,
      jobCode: job.jobCode,
      parts: (job.partsUsed ?? []).map((p) => ({
        daysSinceDelivered: daysSince,
        id: p.id,
        kind: "part" as const,
        name: p.partName,
        warrantyDays: defaultWarranty,
      })),
      repairs: (job.repairs ?? []).map((r) => ({
        daysSinceDelivered: daysSince,
        id: r.id,
        kind: "repair" as const,
        name: r.repairName,
        warrantyDays: defaultWarranty,
      })),
    };
  }, [job]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="material-symbols-outlined animate-spin text-2xl text-on-surface-variant">
          progress_activity
        </span>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="py-20 text-center">
        <span className="material-symbols-outlined text-3xl text-error">
          error
        </span>
        <p className="mt-2 font-body text-error text-sm">
          {error ?? t("jobs_detail_not_found")}
        </p>
        <div className="mt-4 flex items-center justify-center gap-3">
          <Link
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary px-5 font-bold font-headline text-on-primary text-sm transition-colors hover:bg-primary-container hover:text-on-primary-container"
            to="/jobs"
          >
            {t("jobs_detail_back")}
          </Link>
          <button
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-surface-container-high px-5 font-bold font-headline text-on-surface text-sm transition-colors hover:bg-surface-container-highest"
            onClick={fetchJob}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              refresh
            </span>
            {t("retry", { defaultValue: "Try again" })}
          </button>
        </div>
      </div>
    );
  }

  const partsTotal = (job.partsUsed ?? []).reduce(
    (s, p) => s + toNum(p.totalCost),
    0
  );
  const repairsTotal = (job.repairs ?? []).reduce(
    (s, r) => s + toNum(r.price),
    0
  );
  const deposit = toNum(job.depositAmount);
  const paidTotal = toNum(job.paidTotal);
  const balanceDue = Math.max(
    0,
    partsTotal + repairsTotal - deposit - paidTotal
  );
  const finalCost = partsTotal + repairsTotal - deposit;
  const jobMargin = (job as Record<string, unknown>).margin as
    | number
    | undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:max-w-4xl">
      <Link
        className="inline-flex min-h-[44px] items-center gap-1 font-bold text-primary text-sm hover:underline"
        to="/jobs"
      >
        <span className="material-symbols-outlined text-sm">arrow_back</span>
        {t("jobs_detail_back")}
      </Link>

      {/* ── Hero: device, problem, status, cost ── */}
      <div className="mt-6 rounded-2xl bg-surface-container-high p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("intake.device_section")}
            </p>
            <h1 className="mt-0.5 font-extrabold font-headline text-2xl text-on-surface tracking-tight sm:text-3xl">
              {[job.device?.brand?.name, job.device?.model]
                .filter(Boolean)
                .join(" ") || "—"}
            </h1>
            {job.reportedProblem && (
              <p className="mt-1.5 line-clamp-2 font-body text-on-surface-variant text-sm leading-relaxed">
                {job.reportedProblem}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center pt-1">
            <StatusPopover job={job} onChanged={() => fetchJob()} />
          </div>
        </div>

        {/* Spec-sheet: estimated cost & delivery */}
        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
          {job.imei && (
            <div>
              <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
                IMEI
              </p>
              <p className="mt-0.5 font-bold font-headline text-lg text-on-surface">
                {job.imei}
              </p>
            </div>
          )}
          <div>
            <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("intake.estimated_cost")}
            </p>
            <p className="mt-0.5 font-bold font-headline text-lg text-on-surface">
              {fmt(
                typeof job.estimatedCost === "number"
                  ? job.estimatedCost
                  : Number(job.estimatedCost ?? 0)
              )}
            </p>
          </div>
          {job.estimatedDate && (
            <div>
              <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
                {t("intake.delivery_date")}
              </p>
              <p className="mt-0.5 font-bold font-headline text-lg text-on-surface">
                {new Date(job.estimatedDate).toLocaleDateString()}
              </p>
            </div>
          )}
          {job.deviceUnlockCode && (
            <div>
              <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
                {t("jobs_detail_unlock_code")}
              </p>
              <p className="mt-0.5 font-bold font-headline text-lg text-on-surface tracking-wider">
                {job.deviceUnlockCode}
              </p>
            </div>
          )}
        </div>

        <JobIntakeChips
          accessories={job.accessories}
          intakeChecklist={job.intakeChecklist}
        />

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 font-bold font-headline text-on-primary text-sm transition-colors hover:bg-primary-container hover:text-on-primary-container"
            onClick={() =>
              window.open(`/api/receipts/${job.id}/receipt`, "_blank")
            }
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            {t("jobs_detail_print")}
          </button>
          <Link
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-surface-container-low px-5 font-bold font-headline text-on-surface text-sm transition-colors hover:bg-surface-container hover:text-on-surface"
            to={`/tracking/${job.jobCode}`}
          >
            <span className="material-symbols-outlined text-[18px]">
              open_in_new
            </span>
            {t("jobs_detail_track")}
          </Link>

          <span
            aria-hidden="true"
            className="hidden h-6 w-px bg-outline-variant/40 sm:block"
          />

          <button
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface"
            onClick={handleCopyTrackLink}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">share</span>
            {t("jobs_detail_share")}
          </button>
          <JobPortalLink
            accessCode={job.accessCode}
            jobId={job.id}
            onChanged={fetchJob}
            published={portalPublished}
          />
          <button
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface"
            onClick={() =>
              window.open(`/api/receipts/${job.id}/label`, "_blank")
            }
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">label</span>
            {t("jobs_detail_print_label")}
          </button>
          <Can perm={{ returns: ["create"] }}>
            {job.status === "DELIVERED" && (
              <button
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface"
                onClick={() => setShowReturnWizard(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">
                  assignment_return
                </span>
                {t("returns_file_button")}
              </button>
            )}
          </Can>
        </div>
      </div>

      {/* ── Details strip: customer, technician ── */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-surface-container p-5">
          <div className="flex items-center justify-between">
            <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
              {t("customers")}
            </p>
            <Can perm={{ customers: ["edit"] }}>
              <button
                className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-primary transition-colors hover:bg-primary/10"
                onClick={() => setShowEditCustomer(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">
                  edit
                </span>
                <span className="font-label text-xs">{t("edit")}</span>
              </button>
            </Can>
          </div>
          <p className="mt-1 font-body font-semibold text-base text-on-surface">
            {job.customer?.name}
          </p>
          <p className="font-label text-on-surface-variant text-sm">
            {job.customer?.phone}
          </p>
          {job.customer?.email && (
            <p className="font-label text-on-surface-variant text-sm">
              {job.customer.email}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-surface-container p-5">
          <p className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
            {t("technician")}
          </p>
          <div className="mt-2">
            <TechnicianSelect
              currentTechnicianId={job.technician?.id}
              currentTechnicianName={job.technician?.name}
              jobId={job.id}
              onChanged={() => fetchJob()}
              size="md"
            />
          </div>
        </div>
      </div>

      {/* ── Visual record: photos + history ── */}
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <JobPhotosSection job={job} onChanged={() => fetchJob()} />
        <div className="mt-8">
          <h2 className="mb-4 font-bold font-headline text-base text-on-surface">
            {t("jobs_detail_history")}
          </h2>
          <StatusHistoryTimeline jobId={job.id} />
        </div>
      </div>

      {/* ── Work breakdown: parts + repairs ── */}
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <JobPartsSection job={job} onChanged={() => fetchJob()} />
        <div className="mt-3">
          <JobRepairsSection job={job} onChanged={() => fetchJob()} />
        </div>
      </div>

      {/* ── Quotes ── */}
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <JobQuotesSection
          estimatedCost={toNum(job.estimatedCost)}
          jobId={job.id}
          onChanged={() => fetchJob()}
        />
      </div>

      {/* ── Payments ── */}
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <JobPaymentsSection
          balanceDue={balanceDue}
          jobId={job.id}
          onChanged={() => fetchJob()}
          paymentOnDeliveryMethod={job.paymentOnDeliveryMethod ?? null}
          status={job.status}
        />
      </div>

      {/* ── Waiting parts ── */}
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <JobWaitingPartsSection job={job} onChanged={() => fetchJob()} />
      </div>

      {/* ── Notes ── */}
      <div className="mt-8 rounded-2xl bg-surface-container p-6">
        <JobNotesSection job={job} onChanged={() => fetchJob()} />
      </div>

      {/* ── Returns history ── */}
      {job.status === "DELIVERED" && (
        <div className="mt-8 rounded-2xl bg-surface-container p-6">
          <JobReturnsHistorySection jobId={job.id} />
        </div>
      )}

      <div className="mt-8">
        <CostSummary
          balanceDue={balanceDue}
          deposit={deposit}
          finalCost={finalCost}
          margin={jobMargin}
          paidTotal={paidTotal}
          partsTotal={partsTotal}
          repairsTotal={repairsTotal}
        />
      </div>

      {job.customer && (
        <EditCustomerDialog
          customer={job.customer}
          onClose={() => setShowEditCustomer(false)}
          onSaved={handleCustomerSaved}
          open={showEditCustomer}
        />
      )}

      {wizardJob && (
        <CreateWizardModal
          onClose={() => setShowReturnWizard(false)}
          onCreateNewPaidJob={() => {
            navigate("/jobs/new");
          }}
          open={showReturnWizard}
          originalJob={wizardJob}
        />
      )}
    </div>
  );
}
