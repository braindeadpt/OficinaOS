import type { PhotoStage } from "@generated/enums";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useCan } from "@/hooks/use-can";
import { deleteClaimPhoto, uploadClaimPhoto } from "@/lib/api-return-claims";
import type { ReturnClaimDetail } from "@/types/return-claim";

interface Props {
  claim: ReturnClaimDetail;
  onChanged: () => void;
}

const STAGES: PhotoStage[] = ["RETURN_INTAKE", "RETURN_RESOLUTION"];

export default function ClaimPhotosSection({ claim, onChanged }: Props) {
  const { t } = useTranslation();
  const canEdit = useCan({ returns: ["edit"] });
  const intakeRef = useRef<HTMLInputElement>(null);
  const resolutionRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const photosByStage: Record<PhotoStage, typeof claim.photos> = {
    RETURN_INTAKE: claim.photos.filter((p) => p.stage === "RETURN_INTAKE"),
    RETURN_RESOLUTION: claim.photos.filter(
      (p) => p.stage === "RETURN_RESOLUTION"
    ),
  };

  const handleUpload = async (stage: PhotoStage, file: File) => {
    setUploading(true);
    try {
      await uploadClaimPhoto(claim.id, { file, stage });
      onChanged();
      toast.success(t("returns_toast_photo_added"));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (photoId: string) => {
    await deleteClaimPhoto(claim.id, photoId);
    onChanged();
    toast.success(t("returns_toast_photo_removed"));
  };

  return (
    <section className="space-y-4 rounded-2xl bg-surface-container-low p-5">
      <h2 className="font-bold text-on-surface">{t("returns_photos_title")}</h2>

      {STAGES.map((stage) => {
        const ref = stage === "RETURN_INTAKE" ? intakeRef : resolutionRef;
        const list = photosByStage[stage];
        return (
          <div className="space-y-2" key={stage}>
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-on-surface-variant text-sm">
                {stage === "RETURN_INTAKE"
                  ? t("returns_photos_intake")
                  : t("returns_photos_resolution")}
              </h3>
              {canEdit && claim.status === "OPEN" && (
                <>
                  <input
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        handleUpload(stage, f);
                      }
                      e.target.value = "";
                    }}
                    ref={ref}
                    type="file"
                  />
                  <Button
                    disabled={uploading}
                    icon="add_a_photo"
                    onClick={() => ref.current?.click()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("returns_photos_add")}
                  </Button>
                </>
              )}
            </div>

            {list.length === 0 ? (
              <p className="text-on-surface-variant text-sm">
                {stage === "RETURN_INTAKE"
                  ? t("returns_photos_empty_intake")
                  : t("returns_photos_empty_resolution")}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
                {list.map((p) => (
                  <div className="relative" key={p.id}>
                    <img
                      alt=""
                      className="aspect-square w-full rounded-xl object-cover"
                      height={128}
                      src={`/api/uploads/${p.path}`}
                      width={128}
                    />
                    {canEdit && claim.status === "OPEN" && (
                      <button
                        aria-label="remove"
                        className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-error text-on-error"
                        onClick={() => handleRemove(p.id)}
                        type="button"
                      >
                        <Icon name="close" size="sm" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
