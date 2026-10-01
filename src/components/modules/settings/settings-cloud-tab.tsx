import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import api, { getErrorMessage } from "@/lib/api";

interface CloudStatus {
  apiUrl: string | null;
  modules: string[];
  paired: boolean;
  reachable: boolean | null;
  shopId: string | null;
  shopName: string | null;
  syncedAt: string | null;
}

export default function SettingsCloudTab({
  onToast,
}: {
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [code, setCode] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<CloudStatus>("/settings/cloud");
      setStatus(res.data);
      setApiUrl((prev) => prev || res.data.apiUrl || "");
    } catch (err) {
      onToast(getErrorMessage(err, t("errors.generic")), "error");
    } finally {
      setLoading(false);
    }
  }, [onToast, t]);

  useEffect(() => {
    refresh().catch((err) => {
      console.error("Failed to fetch cloud status:", err);
    });
  }, [refresh]);

  async function handlePair() {
    setBusy(true);
    try {
      const res = await api.post<CloudStatus>("/settings/cloud/pair", {
        apiUrl,
        code,
      });
      setStatus(res.data);
      setCode("");
      onToast(t("cloud_pair_success"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("cloud_pair_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      const res = await api.post<CloudStatus>("/settings/cloud/sync");
      setStatus(res.data);
      onToast(t("cloud_sync_success"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("cloud_sync_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpair() {
    setBusy(true);
    try {
      await api.delete("/settings/cloud");
      setStatus({
        paired: false,
        apiUrl,
        shopId: null,
        shopName: null,
        modules: [],
        syncedAt: null,
        reachable: null,
      });
      onToast(t("cloud_unpaired"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("errors.generic")), "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-on-surface-variant text-sm">
        <Icon className="animate-spin" name="progress_activity" />
        {t("loading")}
      </div>
    );
  }

  const paired = status?.paired === true;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      {!paired && (
        <>
          <p className="text-on-surface-variant text-sm">
            {t("cloud_pair_intro")}
          </p>
          <Field label={t("cloud_api_url")}>
            <Input
              autoComplete="off"
              inputMode="url"
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://example.ts.net"
              value={apiUrl}
            />
          </Field>
          <Field label={t("cloud_pairing_code")}>
            <Input
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
              placeholder="OFIC-XXXX-XXXX"
              value={code}
            />
          </Field>
          <div>
            <Button
              disabled={busy || !apiUrl || code.trim().length < 4}
              icon="link"
              onClick={handlePair}
            >
              {t("cloud_connect")}
            </Button>
          </div>
        </>
      )}

      {paired && status && (
        <>
          <div className="flex items-center gap-2">
            <Badge variant={status.reachable === false ? "error" : "success"}>
              {status.reachable === false
                ? t("cloud_unreachable")
                : t("cloud_connected")}
            </Badge>
            {status.shopName && (
              <span className="font-medium text-on-surface text-sm">
                {status.shopName}
              </span>
            )}
          </div>

          <div className="rounded-2xl bg-surface-container-low p-4">
            <div className="mb-2 font-semibold text-on-surface text-sm">
              {t("cloud_active_modules")}
            </div>
            {status.modules.length === 0 ? (
              <p className="text-on-surface-variant text-sm">
                {t("cloud_no_modules")}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {status.modules.map((m) => (
                  <Badge key={m} variant="secondary">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-3 text-on-surface-variant text-xs">
              {t("cloud_last_sync")}:{" "}
              {status.syncedAt
                ? new Date(status.syncedAt).toLocaleString()
                : t("never")}
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              disabled={busy}
              icon="sync"
              onClick={handleSync}
              variant="secondary"
            >
              {t("cloud_sync_now")}
            </Button>
            <Button
              disabled={busy}
              icon="link_off"
              onClick={handleUnpair}
              variant="destructive"
            >
              {t("cloud_disconnect")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
