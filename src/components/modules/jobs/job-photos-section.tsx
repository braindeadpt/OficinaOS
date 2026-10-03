import { INACTIVE_STATUSES } from "@shared/constants";
import type { Job } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";

interface JobPhotosSectionProps {
  job: Job;
  onChanged?: () => void;
}

export default function JobPhotosSection({
  job,
  onChanged,
}: JobPhotosSectionProps) {
  const { t } = useTranslation();
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const photos = job.photos ?? [];
  const isTerminal = INACTIVE_STATUSES.includes(
    job.status as (typeof INACTIVE_STATUSES)[number]
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addPhotoRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(
    async (files: FileList) => {
      setUploading(true);
      let uploaded = 0;
      await Promise.allSettled(
        Array.from(files).map(async (file) => {
          const form = new FormData();
          form.append("file", file);
          try {
            await api.post(`/jobs/${job.id}/photos`, form);
            uploaded++;
          } catch {
            /* individual failure counted */
          }
        })
      );
      setUploading(false);
      if (uploaded > 0) {
        toast.success(t("job_photo_upload_success"));
        onChanged?.();
      }
    },
    [job.id, onChanged, t]
  );

  const photoUrl = (path: string) => `${api.defaults.baseURL}/uploads/${path}`;

  const handleDelete = useCallback(
    async (photoId: string) => {
      if (confirmDelete !== photoId) {
        setConfirmDelete(photoId);
        return;
      }
      setDeleting((prev) => new Set(prev).add(photoId));
      setConfirmDelete(null);
      try {
        await api.delete(`/jobs/${job.id}/photos/${photoId}`);
        toast.success(t("job_photo_remove_success"));
        onChanged?.();
      } catch {
        toast.error(t("job_photo_remove_failed"));
      } finally {
        setDeleting((prev) => {
          const next = new Set(prev);
          next.delete(photoId);
          return next;
        });
      }
    },
    [confirmDelete, job.id, onChanged, t]
  );

  if (photos.length === 0) {
    return (
      <>
        <h2 className="mb-4 font-bold font-headline text-base text-on-surface">
          {t("intake.device_photos")}
        </h2>
        <div className="flex flex-col items-center rounded-xl bg-surface-container-low/50 py-8">
          <span className="material-symbols-outlined mb-2 text-3xl text-on-surface-variant/60">
            photo_camera
          </span>
          <p className="font-bold font-headline text-on-surface-variant text-sm">
            {t("jobs_photos_empty_title")}
          </p>
          <p className="mt-1 font-body text-on-surface-variant/80 text-xs">
            {t("jobs_photos_empty_desc")}
          </p>
          {!isTerminal && (
            <button
              className="mt-3 flex min-h-[44px] items-center gap-1 rounded-lg bg-primary px-3 font-bold font-label text-on-primary text-xs uppercase tracking-wider transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:opacity-60"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">
                add_a_photo
              </span>
              {uploading ? t("loading") : t("jobs_photos_add")}
            </button>
          )}
        </div>
        <input
          accept="image/*"
          capture="environment"
          className="hidden"
          multiple
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) {
              handleUpload(files);
            }
            e.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
      </>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold font-headline text-base text-on-surface">
          {t("intake.device_photos")}
        </h2>
        <div className="flex items-center gap-2">
          {!isTerminal && (
            <button
              className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 py-1 font-bold font-label text-primary text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-high"
              onClick={() => addPhotoRef.current?.click()}
              type="button"
            >
              <span className="material-symbols-outlined text-sm">
                add_a_photo
              </span>
              {uploading ? t("loading") : t("jobs_photos_add")}
            </button>
          )}
          <button
            className="flex min-h-[44px] items-center gap-1 rounded-lg px-3 py-1 font-bold font-label text-on-surface-variant text-xs uppercase tracking-wider transition-colors hover:bg-surface-container-high"
            onClick={() => {
              setEditMode(!editMode);
              if (editMode) {
                setConfirmDelete(null);
              }
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-sm">
              {editMode ? "check" : "edit"}
            </span>
            {editMode ? t("done") : t("edit")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {photos.map((photo) => (
          <div
            className={`group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl ring-1 ring-outline-variant ${editMode ? "ring-2 ring-primary" : ""}`}
            key={photo.id}
          >
            <button
              className="h-full w-full"
              onClick={() => setLightboxUrl(photoUrl(photo.path))}
              type="button"
            >
              <img
                alt={t("intake.device_photos")}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                height={96}
                loading="lazy"
                src={photoUrl(photo.path)}
                width={96}
              />
            </button>
            <button
              aria-label={
                confirmDelete === photo.id
                  ? t("jobs_detail_confirm_remove")
                  : t("intake.remove_photo")
              }
              className={`absolute inset-0 flex items-center justify-center bg-on-surface/50 transition-opacity ${confirmDelete === photo.id || editMode ? "opacity-100" : "sm:opacity-0 sm:group-hover:opacity-100"}`}
              disabled={deleting.has(photo.id)}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(photo.id);
              }}
              type="button"
            >
              {deleting.has(photo.id) && (
                <span className="material-symbols-outlined animate-spin text-lg text-on-primary">
                  progress_activity
                </span>
              )}
              {!deleting.has(photo.id) && confirmDelete === photo.id && (
                <span className="rounded-md bg-error px-2 py-1 font-bold font-label text-on-error text-xs">
                  {t("jobs_detail_confirm_remove")}
                </span>
              )}
              {!deleting.has(photo.id) && confirmDelete !== photo.id && (
                <span className="material-symbols-outlined text-lg text-on-primary">
                  delete
                </span>
              )}
            </button>
          </div>
        ))}
      </div>

      {lightboxUrl && (
        <LightboxOverlay
          onClose={() => setLightboxUrl(null)}
          src={lightboxUrl}
        />
      )}
      <input
        accept="image/*"
        capture="environment"
        className="hidden"
        multiple
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) {
            handleUpload(files);
          }
          e.target.value = "";
        }}
        ref={addPhotoRef}
        type="file"
      />
    </>
  );
}

function LightboxOverlay({
  onClose,
  src,
}: {
  onClose: () => void;
  src: string;
}) {
  const { t } = useTranslation();
  const overlayRef = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<{ y: number; time: number } | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    overlayRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && overlayRef.current) {
        e.preventDefault();
        overlayRef.current.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [onClose]);

  function handleTouchStart(e: React.TouchEvent) {
    swipeStart.current = {
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!swipeStart.current) {
      return;
    }
    const deltaY = e.changedTouches[0].clientY - swipeStart.current.y;
    const elapsed = Date.now() - swipeStart.current.time;
    swipeStart.current = null;
    if (elapsed < 500 && Math.abs(deltaY) > 80) {
      onClose();
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleOverlayTouchEnd(e: React.TouchEvent) {
    if (e.target === e.currentTarget) {
      handleTouchEnd(e);
      return;
    }
  }

  function handleOverlayTouchStart(e: React.TouchEvent) {
    if (e.target === e.currentTarget) {
      handleTouchStart(e);
    }
  }

  return (
    <button
      aria-label={t("close_modal")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/60"
      onClick={handleOverlayClick}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
      onTouchEnd={handleOverlayTouchEnd}
      onTouchStart={handleOverlayTouchStart}
      ref={overlayRef}
      type="button"
    >
      {/* biome-ignore lint/correctness/useImageSize: lightbox image uses CSS sizing */}
      <img
        alt={t("intake.device_photos")}
        className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl"
        src={src}
      />
    </button>
  );
}
