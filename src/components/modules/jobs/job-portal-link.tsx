import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api, { getErrorMessage } from "@/lib/api";

interface CloudStatus {
  apiUrl: string | null;
  modules: string[];
  paired: boolean;
}

const TRAILING_SLASH_RE = /\/+$/;

/**
 * Public portal link for a job (OficinaOS Cloud "portal" module).
 * Shows "Public link" to publish, or the active link + remove once live.
 */
export default function JobPortalLink({
  jobId,
  accessCode,
  published,
  onChanged,
}: {
  jobId: string;
  accessCode: string | undefined;
  published: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<CloudStatus>("/settings/cloud")
      .then((res) => setCloud(res.data))
      .catch(() => setCloud(null));
  }, []);

  const copyLink = useCallback(
    (url: string) => {
      navigator.clipboard.writeText(url).then(
        () => toast.success(t("jobs_detail_portal_link_copied")),
        (err) => console.error("Failed to copy portal link:", err)
      );
    },
    [t]
  );

  const portalUrl =
    cloud?.apiUrl && accessCode
      ? `${cloud.apiUrl.replace(TRAILING_SLASH_RE, "")}/t/${accessCode}`
      : null;

  const publish = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`/jobs/${jobId}/portal`);
      copyLink(res.data.url);
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, t("errors.generic")));
    } finally {
      setBusy(false);
    }
  }, [jobId, copyLink, onChanged, t]);

  const unpublish = useCallback(async () => {
    setBusy(true);
    try {
      await api.delete(`/jobs/${jobId}/portal`);
      onChanged();
    } catch (err) {
      toast.error(getErrorMessage(err, t("errors.generic")));
    } finally {
      setBusy(false);
    }
  }, [jobId, onChanged, t]);

  if (!(cloud?.paired && cloud.modules.includes("portal"))) {
    return null;
  }

  if (!published) {
    return (
      <button
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface"
        disabled={busy}
        onClick={publish}
        type="button"
      >
        <span className="material-symbols-outlined text-[18px]">public</span>
        {t("jobs_detail_portal_publish")}
      </button>
    );
  }

  return (
    <>
      {portalUrl && (
        <button
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-surface-container-low px-4 font-bold font-headline text-primary text-sm transition-colors hover:bg-surface-container"
          onClick={() => copyLink(portalUrl)}
          title={portalUrl}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">public</span>
          {t("jobs_detail_portal_published")}
        </button>
      )}
      <button
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface"
        disabled={busy}
        onClick={unpublish}
        type="button"
      >
        <span className="material-symbols-outlined text-[18px]">link_off</span>
        {t("jobs_detail_portal_unpublish")}
      </button>
    </>
  );
}
