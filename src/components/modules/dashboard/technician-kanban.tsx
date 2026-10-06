import {
  JOB_STATUS_FLOW,
  JobStatus,
  type JobStatusType,
  QC_CHECK_ITEMS,
} from "@shared/constants";
import type { KanbanJobDTO } from "@shared/types/dashboard";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import FunctionalChecklist from "@/components/modules/jobs/intake-modal/functional-checklist";
import type { IntakeChecklist } from "@/components/modules/jobs/intake-modal/types";
import { Icon } from "@/components/ui/icon";
import { useDashboardStore } from "@/stores/dashboard";
import { useJobsStore } from "@/stores/jobs";

export default function TechnicianKanban() {
  const { t } = useTranslation();
  const { techData, fetchTechnician } = useDashboardStore();
  const transitionStatus = useJobsStore((s) => s.transitionStatus);

  const [activeTab, setActiveTab] = useState<string>("POOL");
  const [transitioningJob, setTransitioningJob] = useState<KanbanJobDTO | null>(
    null
  );
  const [targetStatus, setTargetStatus] = useState<JobStatusType | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [qc, setQc] = useState<IntakeChecklist>({});
  const [loading, setLoading] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  const poolJobs = techData?.poolJobs ?? [];
  const myJobs = techData?.myJobs ?? [];

  // Group jobs by column
  const columns = useMemo(
    () => ({
      POOL: poolJobs,
      INTAKE: myJobs.filter((j) => j.status === JobStatus.INTAKE),
      IN_REPAIR: myJobs.filter((j) => j.status === JobStatus.IN_REPAIR),
      WAITING_FOR_PARTS: myJobs.filter(
        (j) => j.status === JobStatus.WAITING_FOR_PARTS
      ),
      ON_HOLD: myJobs.filter((j) => j.status === JobStatus.ON_HOLD),
      DONE: myJobs.filter((j) => j.status === JobStatus.DONE),
    }),
    [poolJobs, myJobs]
  );

  const columnKeys = [
    "POOL",
    "INTAKE",
    "IN_REPAIR",
    "WAITING_FOR_PARTS",
    "ON_HOLD",
    "DONE",
  ] as const;

  const handleClaim = async (jobId: string) => {
    setLoading(true);
    try {
      await transitionStatus(jobId, JobStatus.IN_REPAIR);
      toast.success(t("tech_dashboard.claim_success"));
      await fetchTechnician();
    } catch {
      toast.error(t("job_status_failed"));
    } finally {
      setLoading(false);
    }
  };

  const startTransition = (job: KanbanJobDTO, nextStatus: JobStatusType) => {
    setActiveDropdown(null);
    setTransitioningJob(job);
    setTargetStatus(nextStatus);
    setHoldReason("");
    setLaborHours("");
    setQc({});

    // If it doesn't require extra inputs, execute immediately
    if (nextStatus !== JobStatus.ON_HOLD && nextStatus !== JobStatus.DONE) {
      executeTransition(job.id, nextStatus);
    }
  };

  const executeTransition = async (
    jobId: string,
    status: JobStatusType,
    reason?: string,
    hours?: number,
    qcChecklist?: IntakeChecklist
  ) => {
    setLoading(true);
    try {
      await transitionStatus(jobId, status, reason, hours, qcChecklist);
      toast.success(t("tech_dashboard.status_changed"));
      setTransitioningJob(null);
      setTargetStatus(null);
      await fetchTechnician();
    } catch {
      toast.error(t("job_status_failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmModal = () => {
    if (!(transitioningJob && targetStatus)) {
      return;
    }

    if (targetStatus === JobStatus.ON_HOLD) {
      if (!holdReason.trim()) {
        toast.error(t("validations.reason_required"));
        return;
      }
      executeTransition(
        transitioningJob.id,
        targetStatus,
        holdReason,
        undefined
      );
    } else if (targetStatus === JobStatus.DONE) {
      const hoursNum = Number.parseFloat(laborHours);
      if (Number.isNaN(hoursNum) || hoursNum <= 0) {
        toast.error(t("validations.labor_hours_positive"));
        return;
      }
      if (QC_CHECK_ITEMS.some((item) => !qc[item])) {
        toast.error(t("validations.qc_checklist_required"));
        return;
      }
      executeTransition(
        transitioningJob.id,
        targetStatus,
        undefined,
        hoursNum,
        qc
      );
    }
  };

  return (
    <div className="mt-8 rounded-xl bg-surface-container-low p-4 ring-1 ring-surface-container-low/50 md:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="font-extrabold font-headline text-lg text-on-surface tracking-tight md:text-xl">
            {t("tech_dashboard.my_repair_board")}
          </h3>
          <p className="mt-0.5 text-on-surface-variant text-xs md:text-sm">
            {t("tech_dashboard.subtitle")}
          </p>
        </div>
      </div>

      {/* Mobile view: Horizontal Tab Selector */}
      <div className="mb-6 block border-surface-container-highest border-b md:hidden">
        <div className="scrollbar-none flex gap-2 overflow-x-auto pb-2">
          {columnKeys.map((colKey) => {
            const count = columns[colKey].length;
            const isActive = activeTab === colKey;
            return (
              <button
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 font-bold font-headline text-sm transition-all ${
                  isActive
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
                }`}
                key={colKey}
                onClick={() => setActiveTab(colKey)}
                type="button"
              >
                <span>
                  {t(`tech_dashboard.kanban_${colKey.toLowerCase()}`)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    isActive
                      ? "bg-on-primary/20 text-on-primary"
                      : "bg-surface-container-highest text-on-surface"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop view: 6-column grid | Mobile view: Active tab display */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-6 md:overflow-x-auto md:pb-4">
        {columnKeys.map((colKey) => {
          const colJobs = columns[colKey];
          const isMobileHidden = activeTab !== colKey;

          return (
            <div
              className={`flex-col rounded-xl bg-surface-container-lowest/40 p-4 ring-1 ring-surface-container-high/40 md:flex md:h-[600px] md:min-w-[250px] ${
                isMobileHidden ? "hidden md:flex" : "flex"
              }`}
              key={colKey}
            >
              {/* Column Header */}
              <div className="mb-4 flex items-center justify-between border-surface-container-high border-b pb-2">
                <span className="font-extrabold font-headline text-on-surface text-sm uppercase tracking-wider">
                  {t(`tech_dashboard.kanban_${colKey.toLowerCase()}`)}
                </span>
                <span className="rounded-full bg-surface-container px-2 py-0.5 font-bold font-headline text-on-surface-variant text-xs">
                  {colJobs.length}
                </span>
              </div>

              {/* Jobs Cards Container */}
              <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto pr-1 md:max-h-[500px]">
                {colJobs.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center rounded-lg border border-surface-container-high border-dashed p-4 text-center">
                    <Icon
                      className="text-3xl text-surface-container-highest"
                      name="inbox"
                    />
                    <span className="mt-1 text-on-surface-variant text-xs">
                      {t("no_records")}
                    </span>
                  </div>
                ) : (
                  colJobs.map((job) => {
                    // Delivery is the front desk's job and always goes
                    // through the delivery dialog (balance, payment, receipt).
                    const availableStatuses = (
                      JOB_STATUS_FLOW[job.status] ?? []
                    ).filter((s) => s !== JobStatus.DELIVERED);
                    const isDropdownOpen = activeDropdown === job.id;

                    return (
                      <div
                        className="group relative rounded-xl bg-surface-container p-4 shadow-sm ring-1 ring-surface-container-high/40 transition-all hover:bg-surface-container-high hover:shadow-md"
                        key={job.id}
                      >
                        {/* Job Code */}
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold font-headline text-primary text-xs">
                            {job.jobCode}
                          </span>
                          {/* Urgent Badge */}
                          {job.isUrgent && (
                            <span className="flex items-center gap-0.5 rounded bg-error-container px-1.5 py-0.5 font-extrabold font-headline text-[10px] text-on-error-container">
                              <Icon
                                className="text-[12px]"
                                name="priority_high"
                              />
                              {t("intake.urgent")}
                            </span>
                          )}
                          {/* Done Badge */}
                          {job.status === JobStatus.DONE &&
                            job.actualLaborHours && (
                              <span className="rounded bg-success/15 px-1.5 py-0.5 font-extrabold font-headline text-[10px] text-success">
                                {job.actualLaborHours} {t("hours_short", "hrs")}
                              </span>
                            )}
                          {/* Hold Badge */}
                          {job.status === JobStatus.ON_HOLD &&
                            job.holdReason && (
                              <span
                                className="max-w-[100px] truncate rounded bg-tertiary/15 px-1.5 py-0.5 font-extrabold font-headline text-[10px] text-tertiary"
                                title={job.holdReason}
                              >
                                {job.holdReason}
                              </span>
                            )}
                        </div>

                        {/* Device Model */}
                        <h4 className="mt-2 font-extrabold font-headline text-on-surface text-sm leading-tight">
                          {job.device}
                        </h4>

                        {/* Customer */}
                        <div className="mt-2 flex items-center gap-1.5 text-on-surface-variant text-xs">
                          <Icon className="text-[14px]" name="person" />
                          <span className="truncate">{job.customerName}</span>
                        </div>

                        {/* Problem */}
                        <p className="mt-2 line-clamp-2 text-on-surface-variant text-xs">
                          {job.reportedProblem}
                        </p>

                        {/* Footer details */}
                        <div className="mt-3 flex items-center justify-between border-surface-container-high/30 border-t pt-3">
                          {/* Estimated Date */}
                          <div className="flex items-center gap-1 text-[11px] text-on-surface-variant">
                            <Icon
                              className="text-[13px]"
                              name="calendar_today"
                            />
                            <span>
                              {job.estimatedDate
                                ? new Date(job.estimatedDate).toLocaleString(
                                    undefined,
                                    {
                                      day: "numeric",
                                      hour: "numeric",
                                      minute: "2-digit",
                                      month: "short",
                                    }
                                  )
                                : "—"}
                            </span>
                          </div>

                          {/* Quick Actions */}
                          {colKey === "POOL" ? (
                            <button
                              className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-bold font-headline text-on-primary text-xs shadow transition-all hover:bg-primary/95 disabled:opacity-50"
                              disabled={loading}
                              onClick={() => handleClaim(job.id)}
                              type="button"
                            >
                              <Icon className="text-[12px]" name="front_hand" />
                              <span>{t("tech_dashboard.claim_job")}</span>
                            </button>
                          ) : (
                            availableStatuses.length > 0 && (
                              <div className="relative">
                                <button
                                  className="flex items-center gap-0.5 rounded bg-surface-container-high px-2 py-1 font-bold text-on-surface-variant text-xs ring-1 ring-surface-container-highest transition-all hover:bg-surface-container-highest"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveDropdown(
                                      isDropdownOpen ? null : job.id
                                    );
                                  }}
                                  type="button"
                                >
                                  <span>{t("tech_dashboard.update")}</span>
                                  <Icon
                                    className="text-[14px]"
                                    name="arrow_drop_down"
                                  />
                                </button>

                                {/* Dropdown menu */}
                                {isDropdownOpen && (
                                  <>
                                    <button
                                      aria-label="Close dropdown"
                                      className="fixed inset-0 z-10 cursor-default"
                                      onClick={() => setActiveDropdown(null)}
                                      type="button"
                                    />
                                    <div className="absolute right-0 bottom-full z-20 mb-2 w-44 rounded-lg bg-surface-container-high p-1 shadow-lg ring-1 ring-black/10">
                                      {availableStatuses.map((nextStatus) => (
                                        <button
                                          className="flex w-full items-center rounded-md px-3 py-2 text-left font-bold text-on-surface text-xs hover:bg-surface-container-highest"
                                          key={nextStatus}
                                          onClick={() =>
                                            startTransition(job, nextStatus)
                                          }
                                          type="button"
                                        >
                                          {t(`status.${nextStatus}`)}
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Beautiful Modal for holdReason/laborHours */}
      {transitioningJob && targetStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-surface-container p-6 shadow-xl ring-1 ring-black/10 transition-all">
            <h4 className="font-extrabold font-headline text-lg text-on-surface">
              {targetStatus === JobStatus.ON_HOLD
                ? t("tech_dashboard.hold_reason_title")
                : t("tech_dashboard.labor_hours_title")}
            </h4>
            <p className="mt-1 text-on-surface-variant text-sm">
              {targetStatus === JobStatus.ON_HOLD
                ? t("tech_dashboard.hold_reason_label")
                : t("tech_dashboard.labor_hours_label")}
            </p>

            <div className="mt-4">
              {targetStatus === JobStatus.ON_HOLD ? (
                <textarea
                  className="min-h-[100px] w-full rounded-xl bg-surface-container-high p-3 font-medium text-on-surface text-sm ring-1 ring-surface-container-highest"
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder={t("tech_dashboard.hold_reason_placeholder")}
                  value={holdReason}
                />
              ) : (
                <>
                  <input
                    className="w-full rounded-xl bg-surface-container-high p-3 font-medium text-on-surface text-sm ring-1 ring-surface-container-highest"
                    onChange={(e) => setLaborHours(e.target.value)}
                    placeholder={t("tech_dashboard.labor_hours_placeholder")}
                    step="0.1"
                    type="number"
                    value={laborHours}
                  />
                  <div className="mt-4 max-h-[40vh] overflow-y-auto">
                    <FunctionalChecklist
                      hint={t("qc_dialog.checklist_hint")}
                      legend={t("qc_dialog.checklist_legend")}
                      onChange={setQc}
                      t={t}
                      value={qc}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-xl bg-surface-container-high px-4 py-2 font-bold font-headline text-on-surface text-sm hover:bg-surface-container-highest disabled:opacity-50"
                disabled={loading}
                onClick={() => {
                  setTransitioningJob(null);
                  setTargetStatus(null);
                }}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="rounded-xl bg-primary px-5 py-2 font-bold font-headline text-on-primary text-sm hover:opacity-95 disabled:opacity-50"
                disabled={loading}
                onClick={handleConfirmModal}
                type="button"
              >
                {t("confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
