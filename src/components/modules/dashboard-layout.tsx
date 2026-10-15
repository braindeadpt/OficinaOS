import type { ReactNode } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { toast } from "sonner";
import BottomNav from "@/components/modules/bottom-nav";
import type { IntakeFormData } from "@/components/modules/jobs/intake-modal";
import IntakeModal from "@/components/modules/jobs/intake-modal";
import { mapServerFieldErrors } from "@/components/modules/jobs/intake-modal/types";
import PrintPreviewDialog from "@/components/modules/jobs/print-preview-dialog";
import Sidebar from "@/components/modules/sidebar";
import TopBar from "@/components/modules/top-bar";
import UpdateBanner from "@/components/modules/update-banner";
import { ShopSettingsProvider } from "@/components/providers/shop-settings-provider";
import { ChunkErrorBoundary } from "@/components/ui/chunk-error-boundary";
import api, { getErrorMessage } from "@/lib/api";
import { buildJobPayload } from "@/lib/build-job-payload";
import { useJobsStore } from "@/stores/jobs";
import { useUiStore } from "@/stores/ui";

interface DashboardLayoutProps {
  children: ReactNode;
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
  const { t, i18n } = useTranslation();

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
        // The terms text is frozen into the signed document — send exactly
        // what the signature pad showed, in the UI language the customer saw.
        const job = await createJob({
          ...buildJobPayload(data),
          intakeTermsText: t("intake.terms_text"),
          intakeLocale: i18n.language,
        });
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
        // Field validation errors are marked inline by the modal; only a
        // failure it cannot attribute to a field gets the generic toast,
        // now with the server's actual message.
        if (mapServerFieldErrors(err).step === null) {
          toast.error(getErrorMessage(err, t("jobs_create_error")));
        }
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
      i18n.language,
    ]
  );

  const isInsecureLan =
    typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";

  return (
    <ShopSettingsProvider>
      <div className="min-h-screen overflow-x-hidden bg-background text-on-background">
        {isInsecureLan && (
          <div
            className="bg-error-container px-4 py-2 text-center font-bold text-on-error-container text-xs"
            role="alert"
          >
            {t("lan_insecure_banner")}
          </div>
        )}
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
