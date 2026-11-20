import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import api, { type ApiError } from "@/lib/api";
import { pickSignBaseUrl } from "./intake-modal/remote-signature-url";

// ~3s while a session is pending — each poll also triggers the cloud reply
// pull server-side, so a customer at the counter never waits for the ~2min
// entitlements sync.
const POLL_MS = 3000;

interface LoanerSignatureDialogProps {
  jobId: string;
  onClose: () => void;
  onSigned: () => void;
  open: boolean;
}

interface AccessInfo {
  needsAppUrl?: boolean;
  urls: string[];
}

interface SessionStatus {
  expiresAt: string;
  signatureDataUrl: string | null;
  signed: boolean;
}

/**
 * Digital signature of the loaner responsibility agreement — a document
 * separate from the intake ficha. The session is created server-side from
 * the persisted job, so the customer signs exactly the canonical agreement
 * the shop holds; the signature, document hash and frozen snapshot land on
 * the job once /jobs/:id/loaner-signature confirms nothing drifted.
 */
export default function LoanerSignatureDialog({
  jobId,
  onClose,
  onSigned,
  open,
}: LoanerSignatureDialogProps) {
  const { t } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  const [stale, setStale] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [needsAppUrl, setNeedsAppUrl] = useState(false);
  const sessionRef = useRef<string | null>(null);
  // A signed-but-not-yet-attached session must survive close — its row is
  // consumed by the attach call, so invalidation skips it.
  const signedTokenRef = useRef<string | null>(null);
  const onSignedRef = useRef(onSigned);
  onSignedRef.current = onSigned;

  const invalidatePending = useCallback(() => {
    const token = sessionRef.current;
    sessionRef.current = null;
    if (token && token !== signedTokenRef.current) {
      api.post(`/sign-sessions/${token}/invalidate`).catch(() => undefined);
    }
  }, []);

  const startSession = useCallback(async () => {
    invalidatePending();
    setQrDataUrl(null);
    setRemoteUrl(null);
    setCopied(false);
    setExpired(false);
    setStale(false);
    setLoadError(false);
    setNeedsAppUrl(false);
    try {
      const [sessionRes, infoRes] = await Promise.all([
        api.post(`/jobs/${jobId}/loaner-signature-session`),
        api.get("/public/access-info"),
      ]);
      const { token, cloudSignUrl } = sessionRes.data as {
        cloudSignUrl?: string | null;
        token: string;
      };
      sessionRef.current = token;

      const info = infoRes.data as AccessInfo;
      const base = pickSignBaseUrl(info.urls ?? []);
      const signUrl = cloudSignUrl ?? (base ? `${base}/sign/${token}` : null);
      if (!signUrl) {
        setNeedsAppUrl(Boolean(info.needsAppUrl));
        setLoadError(true);
        return;
      }
      setRemoteUrl(cloudSignUrl ?? null);
      const qr = await QRCode.toDataURL(signUrl, { margin: 1, width: 192 });
      setQrDataUrl(qr);
    } catch {
      setLoadError(true);
    }
  }, [jobId, invalidatePending]);

  useEffect(() => {
    if (!open) {
      return;
    }
    startSession();
    return invalidatePending;
  }, [open, startSession, invalidatePending]);

  useEffect(() => {
    if (!(open && qrDataUrl)) {
      return;
    }
    const poll = setInterval(async () => {
      const token = sessionRef.current;
      if (!token) {
        return;
      }
      try {
        const res = await api.get(`/sign-sessions/${token}`);
        const data = res.data as SessionStatus;
        if (data.signed) {
          clearInterval(poll);
          signedTokenRef.current = token;
          try {
            await api.post(`/jobs/${jobId}/loaner-signature`, { token });
            onSignedRef.current();
            onClose();
          } catch (err) {
            sessionRef.current = null;
            signedTokenRef.current = null;
            if ((err as ApiError).code === "SIGNATURE_STALE") {
              setStale(true);
            } else {
              setLoadError(true);
            }
          }
          return;
        }
        if (new Date(data.expiresAt).getTime() < Date.now()) {
          clearInterval(poll);
          setExpired(true);
        }
      } catch {
        // A dead session (404) means it was never usable — offer a fresh QR.
        clearInterval(poll);
        setExpired(true);
      }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [open, qrDataUrl, jobId, onClose]);

  let content: React.ReactNode;
  if (loadError) {
    // needsAppUrl: container install without APP_URL — the fix is config,
    // not a retry, so it gets its own message and no retry button.
    content = (
      <div className="mt-4 flex flex-col items-center gap-2">
        <p className="text-center text-error text-sm" role="alert">
          {t(
            needsAppUrl
              ? "intake.sign_remote_needs_app_url"
              : "intake.sign_remote_error"
          )}
        </p>
        {!needsAppUrl && (
          <button
            className="font-label text-primary text-sm underline"
            onClick={startSession}
            type="button"
          >
            {t("intake.sign_remote_retry")}
          </button>
        )}
      </div>
    );
  } else if (stale) {
    // The job changed while the link was live — the signature no longer
    // covers the current agreement, so it can't be attached.
    content = (
      <div className="mt-4 flex flex-col items-center gap-2">
        <p className="text-center text-error text-sm" role="alert">
          {t("jobs_detail_loaner_sign_stale")}
        </p>
        <button
          className="font-label text-primary text-sm underline"
          onClick={startSession}
          type="button"
        >
          {t("intake.sign_remote_retry")}
        </button>
      </div>
    );
  } else if (qrDataUrl) {
    content = (
      <>
        <img
          alt={t("intake.sign_remote_qr_alt")}
          className="rounded-xl bg-white p-2 ring-1 ring-outline-variant"
          height={192}
          src={qrDataUrl}
          width={192}
        />
        {expired ? (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-center text-error text-sm" role="alert">
              {t("intake.sign_remote_expired")}
            </p>
            <button
              className="font-label text-primary text-sm underline"
              onClick={startSession}
              type="button"
            >
              {t("intake.sign_remote_retry")}
            </button>
          </div>
        ) : (
          <>
            <p className="mt-4 flex items-center gap-2 text-on-surface-variant text-sm">
              <Icon
                className="animate-pulse text-base"
                name="progress_activity"
              />
              {t("intake.sign_remote_waiting")}
            </p>
            {remoteUrl && (
              <div className="mt-3 w-full">
                <p className="mb-1 text-center text-on-surface-variant text-xs">
                  {t("intake.sign_remote_send_link")}
                </p>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      className="font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                      readOnly
                      value={remoteUrl}
                    />
                  </div>
                  <button
                    className="shrink-0 rounded-lg bg-surface-container-high px-3 py-2 font-label text-on-surface text-xs"
                    onClick={async () => {
                      // Só confirma se a cópia correu mesmo — um writeText
                      // rejeitado (sem foco/permissão) não pode mostrar
                      // «Copiado» com o link por copiar.
                      try {
                        await navigator.clipboard.writeText(remoteUrl);
                        setCopied(true);
                      } catch {
                        /* clipboard indisponível — o input continua selecionável */
                      }
                    }}
                    type="button"
                  >
                    {copied
                      ? t("intake.sign_remote_copied")
                      : t("intake.sign_remote_copy")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </>
    );
  } else {
    content = (
      <div className="flex justify-center py-12">
        <Icon
          className="animate-spin text-3xl text-on-surface-variant"
          name="progress_activity"
        />
      </div>
    );
  }

  return (
    <Dialog
      description={t("jobs_detail_loaner_sign_scan")}
      onClose={onClose}
      open={open}
      size="sm"
      title={t("jobs_detail_loaner_sign_title")}
    >
      <div className="flex flex-col items-center">{content}</div>
    </Dialog>
  );
}
