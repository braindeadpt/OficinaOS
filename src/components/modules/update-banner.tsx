import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

interface VersionInfo {
  latest: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
}

// One-shot check on mount, OWNER only. Dismissal is per-version so the
// banner comes back when the next release ships.
export default function UpdateBanner() {
  const role = useAuthStore((s) => s.role);
  const { t } = useTranslation();
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    if (role !== "OWNER") {
      return;
    }
    let cancelled = false;
    api
      .get<VersionInfo>("/settings/update-check")
      .then((res) => {
        if (cancelled) {
          return;
        }
        const { latest, updateAvailable } = res.data;
        if (!(updateAvailable && latest)) {
          return;
        }
        if (localStorage.getItem(`update-dismissed:${latest}`)) {
          return;
        }
        setInfo(res.data);
      })
      .catch(() => {
        // Offline or no permission — stay silent.
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (!(info?.latest && info.updateAvailable)) {
    return null;
  }
  const latest = info.latest;

  const dismiss = () => {
    localStorage.setItem(`update-dismissed:${latest}`, "1");
    setInfo(null);
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl bg-tertiary-container px-4 py-3">
      <Icon
        className="shrink-0 text-on-tertiary-container"
        name="system_update_alt"
        size="sm"
      />
      <p className="min-w-0 flex-1 text-on-tertiary-container text-sm">
        <span className="font-semibold">
          {t("update_available_title", { version: latest })}
        </span>{" "}
        <span className="text-on-tertiary-container/80">
          {t("update_available_hint")}
        </span>
      </p>
      {info.releaseUrl && (
        <a
          className="shrink-0 font-medium text-on-tertiary-container text-sm underline decoration-on-tertiary-container/40 underline-offset-2 hover:decoration-on-tertiary-container"
          href={info.releaseUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("update_release_notes")}
        </a>
      )}
      <button
        aria-label={t("update_dismiss")}
        className="shrink-0 rounded-lg p-1 text-on-tertiary-container/70 transition hover:text-on-tertiary-container"
        onClick={dismiss}
        type="button"
      >
        <Icon name="close" size="sm" />
      </button>
    </div>
  );
}
