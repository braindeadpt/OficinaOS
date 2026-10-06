import type { IntakeModalProps } from "./types";

export type { IntakeFormData } from "./types";

import ModalFooter from "./modal-footer";
import Step1Content from "./step-1-content";
import Step2Content from "./step-2-content";
import { useIntakeModal } from "./use-intake-modal";

export default function IntakeModal({
  onClose,
  onSubmit,
  open,
  prefill,
}: IntakeModalProps) {
  const m = useIntakeModal({ open, onClose, onSubmit, prefill });

  if (!open) {
    return null;
  }

  const hasErrors =
    Object.keys(m.errors).length > 0 && Object.values(m.touched).some(Boolean);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-2 py-20 lg:p-4"
      role="dialog"
    >
      <button
        aria-label={m.t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={m.handleBackdropClick}
        type="button"
      />

      <div className="modal-surface relative z-10 flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-xl shadow-2xl">
        <form
          className="flex flex-1 flex-col overflow-hidden"
          // Our own validation marks fields inline — the browser's native
          // "Please fill out this field" bubbles are untranslated and fire
          // on hidden step-2 fields.
          noValidate
          onSubmit={m.handleSubmit}
        >
          {hasErrors && (
            <div
              aria-live="polite"
              className="flex items-center gap-3 bg-error-container px-4 py-3 md:px-8"
              role="alert"
            >
              <span className="material-symbols-outlined text-on-error-container">
                error
              </span>
              <p className="font-bold font-label text-on-error-container text-xs">
                {m.t("intake.error_summary")}
              </p>
            </div>
          )}

          {m.submissionSuccess && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-xl bg-surface-container-lowest/95">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-container">
                <span className="material-symbols-outlined text-3xl text-on-primary-container">
                  check_circle
                </span>
              </div>
              <p className="font-bold font-headline text-lg text-on-surface">
                {m.t("intake.success_title")}
              </p>
              <p className="font-label text-on-surface-variant text-sm">
                {m.t("intake.success_message")}
              </p>
            </div>
          )}

          {/* Header */}
          <header className="flex shrink-0 items-center justify-between bg-surface-container-low px-4 py-4 md:px-8 md:py-6">
            <div className="flex items-center gap-4">
              {m.step === 2 && (
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
                  onClick={() => m.setStep(1)}
                  type="button"
                >
                  <span className="material-symbols-outlined">arrow_back</span>
                </button>
              )}
              <div>
                <h1 className="font-bold font-headline text-lg text-on-surface tracking-tight md:text-2xl">
                  {m.step === 1
                    ? m.t("intake_wizard_step1_title")
                    : m.t("intake_wizard_step2_title")}
                </h1>
                <p className="mt-0.5 font-label text-on-surface-variant text-xs">
                  {m.t("intake_wizard_step_indicator", {
                    step: m.step,
                    total: 2,
                  })}
                </p>
              </div>
            </div>
            <button
              className="flex h-11 w-11 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container-high"
              onClick={m.handleCloseClick}
              type="button"
            >
              <span className="material-symbols-outlined text-2xl">close</span>
            </button>
          </header>

          {/* Step bar */}
          <div className="flex h-1 bg-surface-container-highest">
            <div
              className="bg-primary transition-all duration-300"
              style={{ width: m.step === 1 ? "50%" : "100%" }}
            />
          </div>

          {m.step === 1 && (
            <Step1Content
              brandAddQuery={m.brandAddQuery}
              brandCreateError={m.brandCreateError}
              brandQuery={m.brandQuery}
              brandResults={m.brandResults}
              brandSearchError={m.brandSearchError}
              clearBrandSearch={m.clearBrandSearch}
              clearCustomer={m.clearCustomer}
              clearModelSearch={m.clearModelSearch}
              errors={m.errors}
              form={m.form}
              handleBlur={m.handleBlur}
              handleBrandAdd={m.handleBrandAdd}
              handleModelAdd={m.handleModelAdd}
              handleNativeCapture={m.handleNativeCapture}
              handlePhotoRemove={m.handlePhotoRemove}
              handlePhotoSelect={m.handlePhotoSelect}
              handleQuickAdd={m.handleQuickAdd}
              isCapturing={m.isCapturing}
              isCreatingBrand={m.isCreatingBrand}
              isCreatingModel={m.isCreatingModel}
              isNative={m.isNative}
              isSearching={m.isSearching}
              isSearchingBrand={m.isSearchingBrand}
              isSearchingModel={m.isSearchingModel}
              modelAddQuery={m.modelAddQuery}
              modelCreateError={m.modelCreateError}
              modelQuery={m.modelQuery}
              modelResults={m.modelResults}
              modelSearchError={m.modelSearchError}
              photoError={m.photoError}
              photoPreviews={m.photoPreviews}
              query={m.query}
              results={m.results}
              searchBrands={m.searchBrands}
              searchError={m.searchError}
              searchModels={m.searchModels}
              selectBrand={m.selectBrand}
              selectCustomer={m.selectCustomer}
              selectModel={m.selectModel}
              setBrandQuery={m.setBrandQuery}
              setModelQuery={m.setModelQuery}
              setQuery={m.setQuery}
              setShowQuickAdd={m.setShowQuickAdd}
              showBrandAddOption={m.showBrandAddOption}
              showModelAddOption={m.showModelAddOption}
              showQuickAdd={m.showQuickAdd}
              t={m.t}
              touched={m.touched}
              update={m.update}
            />
          )}

          {m.step === 2 && (
            <Step2Content
              errors={m.errors}
              form={m.form}
              handleBlur={m.handleBlur}
              t={m.t}
              touched={m.touched}
              update={m.update}
            />
          )}

          <ModalFooter
            cancelLabel={m.t("intake.cancel_intake")}
            isSubmitting={m.isSubmitting}
            nextLabel={m.t("intake_wizard_next")}
            onClose={m.handleCloseClick}
            onNextStep={m.handleNextStep}
            step={m.step}
            submitLabel={
              m.isSubmitting
                ? m.t("intake.creating_job")
                : m.t("intake.start_repair")
            }
          />
        </form>

        {m.showCloseConfirm && (
          <div
            aria-label={m.t("intake.discard_title")}
            aria-modal="true"
            className="absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-overlay"
            role="dialog"
          >
            <div className="mx-4 w-full max-w-xs space-y-4 rounded-2xl bg-surface-container-lowest p-6 shadow-2xl">
              <div className="text-center">
                <span className="material-symbols-outlined text-3xl text-warning">
                  warning
                </span>
                <h3 className="mt-2 font-bold font-headline text-lg text-on-surface">
                  {m.t("intake.discard_title")}
                </h3>
                <p className="mt-1 font-label text-on-surface-variant text-sm">
                  {m.t("intake.discard_message")}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  className="flex-1 rounded-xl bg-surface-container-high px-4 py-3 font-bold font-headline text-on-surface text-sm transition-colors hover:bg-surface-container"
                  onClick={() => m.setShowCloseConfirm(false)}
                  type="button"
                >
                  {m.t("intake.discard_cancel")}
                </button>
                <button
                  className="flex-1 rounded-xl bg-error px-4 py-3 font-bold font-headline text-on-error text-sm transition-colors hover:bg-error/90"
                  onClick={() => {
                    m.setShowCloseConfirm(false);
                    onClose();
                  }}
                  type="button"
                >
                  {m.t("intake.discard_confirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
