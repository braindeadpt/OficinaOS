import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SignLinkShare from "@/components/modules/jobs/sign-link-share";
import SignaturePad from "@/components/reports/signature-pad";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import api, { type ApiError } from "@/lib/api";
import {
  isRemoteSignUrl,
  pickSignBaseUrl,
} from "./intake-modal/remote-signature-url";

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
  // "here": the customer draws on this screen (staff tablet/counter).
  // "qr": a signing session is created and the customer opens /sign/:token.
  const [mode, setMode] = useState<"here" | "qr">("here");
  const [padDataUrl, setPadDataUrl] = useState<string | null>(null);
  const [savingPad, setSavingPad] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [sendState, setSendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [sendErrorCode, setSendErrorCode] = useState<string | null>(null);
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
    setSendState("idle");
    setSendErrorCode(null);
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
      // The link is shareable/sendable only when a phone can open it from
      // outside the shop: the cloud relay, or a public base URL.
      setRemoteUrl(cloudSignUrl ?? (isRemoteSignUrl(signUrl) ? signUrl : null));
      const qr = await QRCode.toDataURL(signUrl, { margin: 1, width: 192 });
      setQrDataUrl(qr);
    } catch {
      setLoadError(true);
    }
  }, [jobId, invalidatePending]);

  // Staff-initiated send: the server pushes the live link through the
  // shop's messaging channels (WhatsApp/SMS). Only offered when the link
  // is reachable off-LAN — a LAN IP would dead-end on the customer's phone.
  const sendLink = useCallback(async () => {
    const token = sessionRef.current;
    if (!token) {
      return;
    }
    setSendState("sending");
    try {
      await api.post(`/sign-sessions/${token}/send`);
      setSendState("sent");
    } catch (err) {
      setSendState("error");
      const code = (err as ApiError).code;
      setSendErrorCode(
        code === "SIGNATURE_LINK_NO_REMOTE" ||
          code === "SIGNATURE_LINK_NO_CHANNEL"
          ? code
          : null
      );
    }
  }, []);

  const savePadSignature = useCallback(async () => {
    if (!(padDataUrl && jobId)) {
      return;
    }
    setSavingPad(true);
    setLoadError(false);
    try {
      await api.post(`/jobs/${jobId}/loaner-signature`, {
        signatureDataUrl: padDataUrl,
      });
      onSignedRef.current();
      onClose();
    } catch {
      setLoadError(true);
    } finally {
      setSavingPad(false);
    }
  }, [jobId, onClose, padDataUrl]);

  useEffect(() => {
    // Dialog children unmount on close but this component's state persists —
    // reset so a reopen starts on a clean pad/mode, not stale leftovers.
    if (open) {
      setMode("here");
      setPadDataUrl(null);
      setSavingPad(false);
      setLoadError(false);
      setStale(false);
    }
  }, [open]);

  useEffect(() => {
    // No session is created while the staff screen is the signing surface —
    // opening the QR tab is what mints the link.
    if (!(open && mode === "qr")) {
      return;
    }
    startSession();
    return invalidatePending;
  }, [open, mode, startSession, invalidatePending]);

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

  let qrContent: React.ReactNode;
  if (loadError) {
    // needsAppUrl: container install without APP_URL — the fix is config,
    // not a retry, so it gets its own message and no retry button.
    qrContent = (
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
    qrContent = (
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
    qrContent = (
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
              <SignLinkShare
                onSend={sendLink}
                sendErrorCode={sendErrorCode}
                sendState={sendState}
                url={remoteUrl}
              />
            )}
          </>
        )}
      </>
    );
  } else {
    qrContent = (
      <div className="flex justify-center py-12">
        <Icon
          className="animate-spin text-3xl text-on-surface-variant"
          name="progress_activity"
        />
      </div>
    );
  }

  const modeBtn = (active: boolean) =>
    `flex items-center justify-center gap-2 rounded-lg px-3 py-2 font-label text-sm transition-colors ${
      active
        ? "bg-primary text-on-primary"
        : "bg-surface-container-highest text-on-surface-variant hover:text-on-surface"
    }`;

  return (
    <Dialog
      description={
        mode === "qr"
          ? t("jobs_detail_loaner_sign_scan")
          : t("jobs_detail_loaner_sign_here_hint")
      }
      onClose={onClose}
      open={open}
      size="sm"
      title={t("jobs_detail_loaner_sign_title")}
    >
      <div className="flex w-full flex-col items-center">
        <div className="mb-4 grid w-full grid-cols-2 gap-2">
          <button
            className={modeBtn(mode === "here")}
            onClick={() => setMode("here")}
            type="button"
          >
            <Icon className="text-lg" name="draw" />
            {t("jobs_detail_loaner_sign_mode_here")}
          </button>
          <button
            className={modeBtn(mode === "qr")}
            onClick={() => setMode("qr")}
            type="button"
          >
            <Icon className="text-lg" name="qr_code" />
            {t("jobs_detail_loaner_sign_mode_qr")}
          </button>
        </div>
        {mode === "here" ? (
          <div className="w-full">
            <SignaturePad onChange={setPadDataUrl} />
            {padDataUrl && (
              <p className="ms-1 mt-1 flex items-center gap-1 font-label text-success text-xs">
                <Icon className="text-sm" name="check_circle" />
                {t("intake.signature_captured")}
              </p>
            )}
            <button
              className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 font-label text-on-primary text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!padDataUrl || savingPad}
              onClick={savePadSignature}
              type="button"
            >
              {savingPad ? (
                <Icon
                  className="animate-spin align-middle text-base"
                  name="progress_activity"
                />
              ) : (
                t("jobs_detail_loaner_sign_save")
              )}
            </button>
            {loadError && mode === "here" && (
              <p className="mt-2 text-center text-error text-sm" role="alert">
                {t("intake.sign_remote_error")}
              </p>
            )}
          </div>
        ) : (
          qrContent
        )}
      </div>
    </Dialog>
  );
}
