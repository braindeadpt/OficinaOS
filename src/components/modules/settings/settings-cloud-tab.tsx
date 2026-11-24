import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import api, { getErrorMessage } from "@/lib/api";
import { usePontoStore } from "@/stores/ponto";
import SettingsInvoicingSection from "./settings-invoicing-section";
import SettingsPontoSection from "./settings-ponto-section";
import SettingsStorefrontSection from "./settings-storefront-section";

interface CloudStatus {
  apiUrl: string | null;
  modules: string[];
  paired: boolean;
  reachable: boolean | null;
  shopId: string | null;
  shopName: string | null;
  syncedAt: string | null;
}

interface CloudStation {
  createdAt: string;
  id: string;
  label: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  scope: string;
}

export default function SettingsCloudTab({
  onDirtyChange,
  onToast,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [code, setCode] = useState("");
  const [diagCode, setDiagCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [stations, setStations] = useState<CloudStation[] | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [cloudDirty, setCloudDirty] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);
  // Cada secção reporta o seu próprio sujo — a aba fica suja enquanto
  // pelo menos uma tiver rascunho (gravar uma não limpa o aviso da outra).
  const sectionDirtyRef = useRef({ invoicing: false, ponto: false });

  const reportSectionDirty = (
    section: "invoicing" | "ponto",
    dirty: boolean
  ) => {
    sectionDirtyRef.current[section] = dirty;
    const anyDirty =
      sectionDirtyRef.current.invoicing || sectionDirtyRef.current.ponto;
    setCloudDirty(anyDirty);
    onDirtyChange?.(anyDirty);
  };

  const stationStatus = (s: CloudStation): string => {
    if (s.revokedAt) {
      return t("cloud_station_revoked_at", {
        date: new Date(s.revokedAt).toLocaleDateString(),
      });
    }
    if (s.lastSeenAt) {
      return t("cloud_station_last_seen", {
        date: new Date(s.lastSeenAt).toLocaleDateString(),
      });
    }
    return t("cloud_station_never_used");
  };

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<CloudStatus>("/settings/cloud");
      setStatus(res.data);
      setApiUrl((prev) => prev || res.data.apiUrl || "");
      if (res.data.paired) {
        const tok = await api.get<{ tokens: CloudStation[] }>(
          "/settings/cloud/tokens"
        );
        setStations(tok.data.tokens);
      }
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

  async function handleDiagCode() {
    setBusy(true);
    try {
      const res = await api.post<{ code: string; expiresAt: string }>(
        "/settings/cloud/diag-code"
      );
      setDiagCode(res.data);
      onToast(t("cloud_diag_code_success"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("cloud_diag_code_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeStation(tokenId: string) {
    setBusy(true);
    try {
      await api.post(`/settings/cloud/tokens/${tokenId}/revoke`);
      setStations(
        (prev) =>
          prev?.map((s) =>
            s.id === tokenId ? { ...s, revokedAt: new Date().toISOString() } : s
          ) ?? null
      );
      onToast(t("cloud_station_revoked"), "success");
    } catch (err) {
      onToast(getErrorMessage(err, t("cloud_station_revoke_failed")), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      const res = await api.post<CloudStatus>("/settings/cloud/sync");
      setStatus(res.data);
      // A sync pode ter ativado módulos — as secções abaixo recarregam e
      // o store do ponto (gate da sidebar/nav/paleta) é reposto também.
      setSyncNonce((n) => n + 1);
      usePontoStore
        .getState()
        .fetchStatus()
        .catch(() => undefined);
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
      const { data: res } = await api.delete<{ cloudDeleted: boolean }>(
        "/settings/cloud"
      );
      setStatus({
        paired: false,
        apiUrl,
        shopId: null,
        shopName: null,
        modules: [],
        syncedAt: null,
        reachable: null,
      });
      // Desemparelhar corta os entitlements — repõe o gate do ponto.
      usePontoStore
        .getState()
        .fetchStatus()
        .catch(() => undefined);
      onToast(
        t(
          res.cloudDeleted === false
            ? "cloud_unpaired_partial"
            : "cloud_unpaired"
        ),
        "success"
      );
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

          <div className="rounded-2xl bg-surface-container-low p-4">
            <div className="mb-2 font-semibold text-on-surface text-sm">
              {t("cloud_diag_code_title")}
            </div>
            <p className="mb-3 text-on-surface-variant text-xs">
              {t("cloud_diag_code_hint")}
            </p>
            {diagCode && (
              <div className="mb-3 rounded-xl bg-surface-container-high px-4 py-3">
                <span className="font-mono font-semibold text-lg text-on-surface tracking-widest">
                  {diagCode.code}
                </span>
                <p className="mt-1 text-on-surface-variant text-xs">
                  {t("cloud_diag_code_expires")}:{" "}
                  {new Date(diagCode.expiresAt).toLocaleString()}
                </p>
              </div>
            )}
            <Button
              disabled={busy}
              icon="pin"
              onClick={handleDiagCode}
              variant="secondary"
            >
              {t("cloud_diag_code_generate")}
            </Button>
          </div>

          <div className="rounded-2xl bg-surface-container-low p-4">
            <div className="mb-2 font-semibold text-on-surface text-sm">
              {t("cloud_stations_title")}
            </div>
            <p className="mb-3 text-on-surface-variant text-xs">
              {t("cloud_stations_hint")}
            </p>
            {stations === null ? (
              <p className="text-on-surface-variant text-sm">
                {t("cloud_stations_unavailable")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {stations.map((s) => (
                  <li
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-high px-4 py-3"
                    key={s.id}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-on-surface text-sm">
                        {s.label ||
                          (s.scope === "diag"
                            ? t("cloud_station_diag")
                            : t("cloud_station_app"))}
                        {s.scope === "full" && (
                          <span className="ml-2 text-on-surface-variant text-xs">
                            ({t("cloud_station_self")})
                          </span>
                        )}
                      </div>
                      <div className="text-on-surface-variant text-xs">
                        {stationStatus(s)}
                      </div>
                    </div>
                    {s.scope === "diag" && !s.revokedAt && (
                      <Button
                        disabled={busy}
                        onClick={() => setConfirmRevokeId(s.id)}
                        size="sm"
                        variant="destructive"
                      >
                        {t("cloud_station_revoke")}
                      </Button>
                    )}
                    {s.revokedAt && (
                      <Badge variant="secondary">
                        {t("cloud_station_inactive")}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <SettingsStorefrontSection onToast={onToast} />
          <SettingsInvoicingSection
            onDirtyChange={(d) => reportSectionDirty("invoicing", d)}
            onToast={onToast}
          />
          <SettingsPontoSection
            hasUnsavedChanges={cloudDirty}
            onDirtyChange={(d) => reportSectionDirty("ponto", d)}
            onToast={onToast}
            refreshNonce={syncNonce}
          />

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
              onClick={() => setConfirmUnpair(true)}
              variant="destructive"
            >
              {t("cloud_disconnect")}
            </Button>
          </div>
        </>
      )}

      {confirmUnpair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <ConfirmDiscardDialog
            description={t("cloud_disconnect_confirm")}
            discardLabel={t("cloud_disconnect")}
            keepLabel={t("cancel")}
            onDiscard={() => {
              setConfirmUnpair(false);
              handleUnpair();
            }}
            onKeepEditing={() => setConfirmUnpair(false)}
            open
            title={t("cloud_disconnect")}
          />
        </div>
      )}

      {confirmRevokeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay">
          <ConfirmDiscardDialog
            description={t("cloud_station_revoked")}
            discardLabel={t("cloud_station_revoke")}
            keepLabel={t("cancel")}
            onDiscard={() => {
              const tokenId = confirmRevokeId;
              setConfirmRevokeId(null);
              handleRevokeStation(tokenId);
            }}
            onKeepEditing={() => setConfirmRevokeId(null)}
            open
            title={t("cloud_station_revoke")}
          />
        </div>
      )}
    </div>
  );
}
