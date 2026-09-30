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
import { ShopSettingsProvider } from "@/components/providers/shop-settings-provider";
import { ChunkErrorBoundary } from "@/components/ui/chunk-error-boundary";
import api from "@/lib/api";
import { useJobsStore } from "@/stores/jobs";
import { useUiStore } from "@/stores/ui";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const intakeModalOpen = useUiStore((s) => s.intakeModalOpen);
  const closeIntakeModal = useUiStore((s) => s.closeIntakeModal);
  const showPrintPreview = useUiStore((s) => s.showPrintPreview);
  const { createJob, fetchJobs, fetchMetrics } = useJobsStore();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  const handleIntakeSubmit = useCallback(
    async (data: IntakeFormData) => {
      try {
        const job = await createJob({
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
          estimatedCost: Number.parseFloat(data.estimatedCost) || 0,
          estimatedDate: data.estimatedDelivery || undefined,
          depositAmount: data.deposit
            ? Number.parseFloat(data.deposit)
            : undefined,
        });
        toast.success(t("jobs_created_success", { id: job.jobCode || job.id }));
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
        closeIntakeModal();
      } catch {
        toast.error(t("jobs_create_error"));
      }
    },
    [createJob, fetchJobs, fetchMetrics, closeIntakeModal, showPrintPreview, t]
  );

  return (
    <ShopSettingsProvider>
      <div className="min-h-screen overflow-x-hidden bg-background text-on-background">
        <Sidebar />
        <TopBar />
        <main className="min-h-screen p-4 pt-20 pb-24 md:p-8 md:pt-24 md:pb-24 lg:ms-64 lg:pb-8">
          {/* Page crashes stay inside <main> — keying by pathname also
              auto-recovers the boundary on navigation. */}
          <ChunkErrorBoundary key={pathname}>{children}</ChunkErrorBoundary>
        </main>
        <BottomNav />
        <IntakeModal
          onClose={closeIntakeModal}
          onSubmit={handleIntakeSubmit}
          open={intakeModalOpen}
        />
        <PrintPreviewDialog />
      </div>
    </ShopSettingsProvider>
  );
}
