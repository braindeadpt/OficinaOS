import type { ReactNode } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { toast } from "sonner";
import BottomNav from "@/components/modules/bottom-nav";
import type { IntakeFormData } from "@/components/modules/jobs/intake-modal";
import IntakeModal from "@/components/modules/jobs/intake-modal";
import PrintPreviewDialog from "@/components/modules/jobs/print-preview-dialog";
import Sidebar from "@/components/modules/sidebar";
import TopBar from "@/components/modules/top-bar";
import UpdateBanner from "@/components/modules/update-banner";
import { ShopSettingsProvider } from "@/components/providers/shop-settings-provider";
import { ChunkErrorBoundary } from "@/components/ui/chunk-error-boundary";
import api from "@/lib/api";
import { useJobsStore } from "@/stores/jobs";
import { useUiStore } from "@/stores/ui";

interface DashboardLayoutProps {
  children: ReactNode;
}

function buildJobPayload(data: IntakeFormData) {
  return {
    customerEmail: data.customerEmail || undefined,
    customerId: data.customerId || undefined,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    deviceBrand: data.brand || "Unknown",
    deviceBrandId: data.brandId || undefined,
    deviceModel: data.model,
    color: data.color || undefined,
    imei: data.imei || undefined,
    reportedProblem: data.reportedProblem,
    conditionNotes: data.conditionNotes || undefined,
    deviceUnlockCode: data.deviceUnlockCode || undefined,
    accessories: data.accessories.length > 0 ? data.accessories : undefined,
    intakeChecklist:
      Object.keys(data.checklist).length > 0 ? data.checklist : undefined,
    intakeSignatureDataUrl: data.signature ?? undefined,
    // Empty = "por orçamentar" (priced after diagnosis) — send nothing
    // rather than a misleading 0.
    estimatedCost: parseOptionalAmount(data.estimatedCost),
    estimatedDate: data.estimatedDelivery || undefined,
    isUrgent: data.isUrgent,
    depositAmount: data.deposit ? Number.parseFloat(data.deposit) : undefined,
  };
}

function parseOptionalAmount(raw: string): number | undefined {
  if (raw.trim() === "") {
    return;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const intakeModalOpen = useUiStore((s) => s.intakeModalOpen);
  const intakeModalPrefill = useUiStore((s) => s.intakeModalPrefill);
  const intakeRequestId = useUiStore((s) => s.intakeRequestId);
  const closeIntakeModal = useUiStore((s) => s.closeIntakeModal);
  const showPrintPreview = useUiStore((s) => s.showPrintPreview);
  const createJob = useJobsStore((s) => s.createJob);
  const fetchJobs = useJobsStore((s) => s.fetchJobs);
  const fetchMetrics = useJobsStore((s) => s.fetchMetrics);
  const { pathname } = useLocation();
  const { t } = useTranslation();

  // The job was already created — a failed convert link shouldn't block the
  // intake flow, so this reports but never throws.
  const markRequestConverted = useCallback(
    async (jobId: string) => {
      if (!intakeRequestId) {
        return;
      }
      try {
        await api.post(`/intake-requests/${intakeRequestId}/convert`, {
          jobId,
        });
      } catch {
        toast.error(t("requests_convert_error"));
      }
    },
    [intakeRequestId, t]
  );

  const handleIntakeSubmit = useCallback(
    async (data: IntakeFormData) => {
      try {
        const job = await createJob(buildJobPayload(data));
        toast.success(t("jobs_created_success", { id: job.jobCode || job.id }));
        await markRequestConverted(job.id);
        showPrintPreview(job.id);
        if (data.photos.length > 0) {
          await Promise.allSettled(
            data.photos.map((file) => {
              const formData = new FormData();
              formData.append("file", file);
              return api.post(`/jobs/${job.id}/photos`, formData);
            })
          );
        }
        await fetchJobs();
        await fetchMetrics();
        // The modal closes itself via the success-overlay timeout — closing
        // it here would hide the confirmation the user just earned.
      } catch (err) {
        toast.error(t("jobs_create_error"));
        // Rethrow so the modal stays open with its error state instead of
        // showing the success overlay on a failed create.
        throw err;
      }
    },
    [
      createJob,
      fetchJobs,
      fetchMetrics,
      showPrintPreview,
      markRequestConverted,
      t,
    ]
  );

  return (
    <ShopSettingsProvider>
      <div className="min-h-screen overflow-x-hidden bg-background text-on-background">
        <Sidebar />
        <TopBar />
        <main className="min-h-screen p-4 pt-20 pb-24 md:p-8 md:pt-24 md:pb-24 lg:ms-64 lg:pb-8">
          <UpdateBanner />
          {/* Page crashes stay inside <main> — keying by pathname also
              auto-recovers the boundary on navigation. */}
          <ChunkErrorBoundary key={pathname}>
            <div className="animate-fade-slide-up">{children}</div>
          </ChunkErrorBoundary>
        </main>
        <BottomNav />
        <IntakeModal
          onClose={closeIntakeModal}
          onSubmit={handleIntakeSubmit}
          open={intakeModalOpen}
          prefill={intakeModalPrefill ?? undefined}
        />
        <PrintPreviewDialog />
      </div>
    </ShopSettingsProvider>
  );
}
