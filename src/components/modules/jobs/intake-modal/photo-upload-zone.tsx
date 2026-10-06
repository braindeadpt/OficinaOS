import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { CaptureSource } from "@/hooks/use-native-camera";
import { labelCls, MAX_PHOTOS, type PhotoPreview } from "./types";

interface PhotoUploadZoneProps {
  isCapturing: boolean;
  isNative: boolean;
  onNativeCapture: (source: CaptureSource) => Promise<void>;
  onPhotoRemove: (index: number) => void;
  onPhotoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  photoCount: number;
  photoError: string | null;
  photoPreviews: PhotoPreview[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export default function PhotoUploadZone({
  isCapturing,
  isNative,
  onNativeCapture,
  onPhotoSelect,
  onPhotoRemove,
  photoCount,
  photoError,
  photoPreviews,
  t,
}: PhotoUploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  const handleAddPhoto = useCallback(() => {
    if (isNative) {
      setShowSourcePicker(true);
    } else {
      fileInputRef.current?.click();
    }
  }, [isNative]);

  const handleSourcePick = useCallback(
    async (source: CaptureSource) => {
      setShowSourcePicker(false);
      await onNativeCapture(source);
    },
    [onNativeCapture]
  );

  return (
    <div>
      <label className={labelCls} htmlFor="photo-upload">
        {t("intake.device_photos")}
      </label>
      <input
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        id="photo-upload"
        multiple
        onChange={onPhotoSelect}
        ref={fileInputRef}
        type="file"
      />
      {photoPreviews.length === 0 && (
        <button
          className="group flex min-h-[44px] w-full cursor-pointer items-center gap-4 rounded-xl bg-surface-container-low px-5 py-4 ring-1 ring-outline-variant transition-all hover:ring-primary/50 disabled:opacity-50"
          disabled={isCapturing}
          onClick={handleAddPhoto}
          type="button"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest">
            <Icon
              className="text-on-surface-variant text-xl transition-colors group-hover:text-primary"
              name="add_a_photo"
            />
          </div>
          <div className="text-start">
            <p className="font-bold font-headline text-on-surface text-sm">
              {t("intake.photo_upload_title")}
            </p>
            <p className="font-label font-medium text-on-surface-variant text-xs">
              {t("intake.photo_upload_hint")}
            </p>
          </div>
        </button>
      )}
      {photoPreviews.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {photoPreviews.map((photo, idx) => (
              <div
                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-xl ring-1 ring-outline-variant"
                key={photo.url}
              >
                <img
                  alt={`Device ${idx + 1}`}
                  className="h-full w-full object-cover"
                  height={80}
                  src={photo.url}
                  width={80}
                />
                <button
                  aria-label={t("intake.remove_photo")}
                  className="absolute inset-0 flex items-center justify-center rounded-xl bg-overlay opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={() => onPhotoRemove(idx)}
                  type="button"
                >
                  <Icon className="text-lg text-on-primary" name="close" />
                </button>
              </div>
            ))}
            {photoCount < MAX_PHOTOS && (
              <button
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl ring-1 ring-dashed ring-outline-variant transition-all hover:bg-surface-container-highest hover:ring-primary/50 disabled:opacity-50"
                disabled={isCapturing}
                onClick={handleAddPhoto}
                type="button"
              >
                <Icon
                  className="text-2xl text-on-surface-variant transition-colors hover:text-primary"
                  name="add_photo_alternate"
                />
              </button>
            )}
          </div>
          <p className="font-label text-on-surface-variant text-xs">
            {t("intake.photo_count", { current: photoCount, max: MAX_PHOTOS })}
          </p>
          {photoError && (
            <p className="font-label text-error text-xs">{photoError}</p>
          )}
        </div>
      )}
      {photoError && photoPreviews.length === 0 && (
        <p className="mt-2 font-label text-error text-xs">{photoError}</p>
      )}
      {showSourcePicker && (
        <div
          aria-label={t("intake.photo_source_title")}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
        >
          <button
            aria-label={t("intake.photo_source_cancel")}
            className="absolute inset-0 bg-overlay"
            onClick={() => setShowSourcePicker(false)}
            type="button"
          />
          <div className="relative z-10 w-full max-w-xs space-y-2 rounded-t-2xl bg-surface-container-lowest p-4 shadow-2xl sm:rounded-2xl sm:p-6">
            <p className="mb-3 text-center font-bold font-headline text-on-surface text-sm">
              {t("intake.photo_source_title")}
            </p>
            <button
              className="flex w-full items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3 text-start transition-colors hover:bg-surface-container-high"
              onClick={() => handleSourcePick("camera")}
              type="button"
            >
              <Icon className="text-primary" name="photo_camera" size="lg" />
              <span className="font-bold font-headline text-on-surface text-sm">
                {t("intake.photo_source_camera")}
              </span>
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3 text-start transition-colors hover:bg-surface-container-high"
              onClick={() => handleSourcePick("gallery")}
              type="button"
            >
              <Icon className="text-primary" name="photo_library" size="lg" />
              <span className="font-bold font-headline text-on-surface text-sm">
                {t("intake.photo_source_gallery")}
              </span>
            </button>
            <button
              className="mt-1 w-full rounded-xl px-4 py-2.5 text-center font-bold font-label text-on-surface-variant text-xs transition-colors hover:text-on-surface"
              onClick={() => setShowSourcePicker(false)}
              type="button"
            >
              {t("intake.photo_source_cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
