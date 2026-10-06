import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import api, { getErrorMessage } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";

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
      copyTextToClipboard(url).then((ok) => {
        if (ok) {
          toast.success(t("jobs_detail_portal_link_copied"));
        } else {
          console.error("Failed to copy portal link");
        }
      });
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
        <Icon className="text-[18px]" name="public" />
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
          <Icon className="text-[18px]" name="public" />
          {t("jobs_detail_portal_published")}
        </button>
      )}
      <button
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high hover:text-on-surface"
        disabled={busy}
        onClick={unpublish}
        type="button"
      >
        <Icon className="text-[18px]" name="link_off" />
        {t("jobs_detail_portal_unpublish")}
      </button>
    </>
  );
}
