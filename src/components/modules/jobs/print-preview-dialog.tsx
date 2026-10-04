import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useModalEffects } from "@/hooks/use-modal-effects";
import { printJobReceipt } from "@/lib/print";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

// mm → px at 96 dpi — mirror of LABEL_PRESETS in server/services/receipt.service.ts
const LABEL_PX: Record<string, { h: number; w: number }> = {
  "40x20": { h: 76, w: 152 },
  "57x32": { h: 121, w: 215 },
  "62x29": { h: 110, w: 234 },
};
const DEFAULT_DIMS = LABEL_PX["40x20"];
const PREVIEW_SCALE = 2.5;
const PREVIEW_MAX_W = 380;
const PREVIEW_MAX_H = 240;

export default function PrintPreviewDialog() {
  const jobId = useUiStore((s) => s.printPreviewJobId);
  const closePrintPreview = useUiStore((s) => s.closePrintPreview);
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const { shopSettings, fetchShopSettings } = useSettingsStore();

  useModalEffects(!!jobId, closePrintPreview, dialogRef);

  useEffect(() => {
    if (jobId && !shopSettings) {
      fetchShopSettings().catch(() => {
        /* label falls back to the 40x20 preview size */
      });
    }
  }, [jobId, shopSettings, fetchShopSettings]);

  const handlePrintLabel = useCallback(() => {
    window.open(`/api/receipts/${jobId}/label`, "_blank");
  }, [jobId]);

  const handlePrintReceipt = useCallback(() => {
    if (jobId) {
      printJobReceipt(jobId);
    }
  }, [jobId]);

  if (!jobId) {
    return null;
  }

  const dims = LABEL_PX[shopSettings?.labelSize ?? ""] ?? DEFAULT_DIMS;
  const scale = Math.min(
    PREVIEW_SCALE,
    PREVIEW_MAX_W / dims.w,
    PREVIEW_MAX_H / dims.h
  );

  return (
    <div
      aria-labelledby="print-preview-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      ref={dialogRef}
      role="dialog"
    >
      <button
        aria-label={t("close")}
        className="absolute inset-0 bg-on-surface/40"
        onClick={closePrintPreview}
        type="button"
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 bg-surface-container-low px-6 py-4">
          <span className="material-symbols-outlined text-2xl text-primary">
            label
          </span>
          <div className="flex-1">
            <h2
              className="font-bold font-headline text-lg text-on-surface"
              id="print-preview-title"
            >
              {t("print_preview_title")}
            </h2>
            <p className="font-label text-on-surface-variant text-xs">
              {t("print_preview_subtitle")}
            </p>
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container-high"
            onClick={closePrintPreview}
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </header>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-surface-container p-6">
          <div
            className="shrink-0"
            style={{
              height: dims.h * scale,
              width: dims.w * scale,
            }}
          >
            <div
              className="origin-top-left"
              style={{
                height: dims.h,
                transform: `scale(${scale})`,
                width: dims.w,
              }}
            >
              <iframe
                className="h-full w-full border-0"
                src={`/api/receipts/${jobId}/label?preview=1`}
                title={t("print_preview_label_alt")}
              />
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-outline-variant/30 border-t px-6 py-4 sm:flex-row sm:justify-end">
          <button
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-surface-container-high px-5 font-bold font-headline text-on-surface text-sm transition-colors hover:bg-surface-container"
            onClick={closePrintPreview}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              check_circle
            </span>
            {t("print_preview_done")}
          </button>
          <button
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-surface-container-high px-5 font-bold font-headline text-on-surface text-sm transition-colors hover:bg-surface-container"
            onClick={handlePrintReceipt}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              receipt_long
            </span>
            {t("print_preview_receipt")}
          </button>
          <button
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold font-headline text-on-primary text-sm transition-colors hover:bg-primary-container hover:text-on-primary-container"
            onClick={handlePrintLabel}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            {t("print_preview_label")}
          </button>
        </footer>
      </div>
    </div>
  );
}
