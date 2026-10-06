import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { getAvatarSrc } from "@/lib/utils";

function StatSkeleton() {
  return (
    <div className="space-y-1.5">
      <div className="h-3 w-14 animate-pulse rounded bg-surface-container-high" />
      <div className="h-7 w-10 animate-pulse rounded bg-surface-container-highest" />
      <div className="h-3 w-16 animate-pulse rounded bg-surface-container-high" />
    </div>
  );
}

interface ProfileSidebarProps {
  avatarUploading: boolean;
  displayName: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleAvatarRemove: () => void;
  handleAvatarUpload: (file: File, onError: (msg: string) => void) => void;
  image: string | null;
  initials: string;
  isSelf: boolean;
  onAvatarError: (msg: string) => void;
  role: string;
  stats: { completedJobs: number; monthlyJobs: number };
  statsLoading: boolean;
}

export function ProfileSidebar({
  avatarUploading,
  displayName,
  fileInputRef,
  handleAvatarRemove,
  handleAvatarUpload,
  image,
  initials,
  isSelf,
  onAvatarError,
  role,
  stats,
  statsLoading,
}: ProfileSidebarProps) {
  const { t } = useTranslation();

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  return (
    <section className="flex w-full flex-col rounded-lg bg-surface-container-lowest p-8 shadow-sm lg:w-80 lg:shrink-0">
      <div className="relative mx-auto">
        <Avatar
          alt={displayName}
          className="h-24 w-24 text-3xl"
          initials={initials}
          src={getAvatarSrc(image)}
        />
        {avatarUploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-overlay">
            <Icon
              className="animate-spin text-on-primary"
              name="progress_activity"
              size="lg"
            />
          </div>
        )}
        {isSelf && (
          <span
            aria-label={t("profile_online")}
            className="absolute end-0 bottom-1 inline-flex h-4 w-4 rounded-full border-[3px] border-surface-container-lowest bg-success"
            role="status"
          />
        )}
        <input
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              handleAvatarUpload(file, onAvatarError);
            }
            e.target.value = "";
          }}
          ref={fileInputRef}
          type="file"
        />
      </div>

      <h3 className="mt-4 text-center font-bold font-headline text-on-surface text-xl">
        {displayName}
      </h3>
      <div className="mx-auto mt-2 rounded-full bg-primary-tint px-3 py-1 font-bold text-primary text-xs tracking-wide">
        {t(`role.${role}`)}
      </div>

      <div className="mt-6 grid w-full grid-cols-2 gap-4 rounded-2xl bg-surface-container-low p-4">
        {statsLoading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <div>
              <p className="font-bold text-on-surface-variant text-xs uppercase tracking-wider">
                {t("profile_completed")}
              </p>
              <p className="font-extrabold font-headline text-2xl text-primary">
                {stats.completedJobs}
              </p>
              <p className="text-on-surface-variant text-xs">
                {t("profile_total_jobs")}
              </p>
            </div>
            <div>
              <p className="font-bold text-on-surface-variant text-xs uppercase tracking-wider">
                {t("profile_monthly")}
              </p>
              <p className="font-extrabold font-headline text-2xl text-primary">
                {stats.monthlyJobs}
              </p>
              <p className="text-on-surface-variant text-xs">
                {t("profile_repairs")}
              </p>
            </div>
          </>
        )}
      </div>

      {isSelf && (
        <div className="mt-6 flex items-center justify-center gap-4 rounded-2xl bg-surface-container-low p-4">
          <button
            className="flex min-h-[44px] items-center gap-2 font-semibold text-primary text-sm transition-colors hover:underline"
            onClick={triggerFileInput}
            type="button"
          >
            <Icon name="photo_camera" size="sm" />
            {t("profile_change_avatar")}
          </button>
          {image && (
            <button
              className="flex min-h-[44px] items-center gap-2 font-semibold text-sm text-tertiary transition-colors hover:underline"
              onClick={handleAvatarRemove}
              type="button"
            >
              <Icon name="delete" size="sm" />
              {t("profile_remove_avatar")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
