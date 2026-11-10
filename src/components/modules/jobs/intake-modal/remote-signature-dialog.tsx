import { canonicalize, type IntakeDocument } from "@shared/intake-document.js";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import api from "@/lib/api";
import { pickSignBaseUrl } from "./remote-signature-url";

// ~3s while a session is pending — each poll also triggers the cloud reply
// pull server-side, so a customer at the counter never waits for the ~2min
// entitlements sync.
const POLL_MS = 3000;

interface RemoteSignatureDialogProps {
  /** Frozen ficha + terms the customer signs — edits invalidate the link. */
  document: IntakeDocument;
  onClose: () => void;
  onSignature: (dataUrl: string, token: string) => void;
  open: boolean;
}

interface AccessInfo {
  urls: string[];
}

interface SessionStatus {
  expiresAt: string;
  signatureDataUrl: string | null;
  signed: boolean;
}

/**
 * "Sign on the customer's phone" relay: creates a short-lived session, shows
 * a QR for /sign/{token} and polls until the signature lands — then hands it
 * to the intake form, which saves it on the job as usual. The link the phone
 * opens must be reachable from the customer's device, so the base URL comes
 * from /public/access-info (mDNS/LAN URLs), never the staff device's origin.
 *
 * The session freezes the intake document: the customer signs exactly what
 * was on screen when the QR was generated. If the ficha is edited while a
 * session is open, the link is invalidated and a new one must be generated.
 */
export default function RemoteSignatureDialog({
  document,
  onSignature,
  onClose,
  open,
}: RemoteSignatureDialogProps) {
  const { t } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expired, setExpired] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const sessionRef = useRef<string | null>(null);
  // The token whose signature already landed — its row must survive until
  // consumeSignatureSession moves it onto the job, so close/retry never
  // invalidates it.
  const signedTokenRef = useRef<string | null>(null);
  // The document the live session was created over — any drift invalidates.
  // Kept in a ref so form edits don't restart the session — they kill it.
  const frozenDocRef = useRef<string | null>(null);
  const documentRef = useRef(document);
  documentRef.current = document;
  const onSignatureRef = useRef(onSignature);
  onSignatureRef.current = onSignature;

  // The remote link is only meant to live while this dialog is open: on
  // close (or when a fresh QR supersedes it) a pending session is
  // invalidated — locally and its cloud copy — so a link sent and forgotten
  // can't be signed into nothing.
  const invalidatePending = useCallback(() => {
    const token = sessionRef.current;
    sessionRef.current = null;
    frozenDocRef.current = null;
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
    setLoadError(false);
    const doc = documentRef.current;
    try {
      const [sessionRes, infoRes] = await Promise.all([
        api.post("/sign-sessions", { document: doc }),
        api.get("/public/access-info"),
      ]);
      const { token, cloudSignUrl } = sessionRes.data as {
        cloudSignUrl?: string | null;
        token: string;
      };
      sessionRef.current = token;
      frozenDocRef.current = canonicalize(doc);

      // Pro signature-remote gives a public cloud link that works anywhere;
      // without it the QR needs a LAN-reachable base for the phone.
      const urls = (infoRes.data as AccessInfo).urls ?? [];
      const base = pickSignBaseUrl(urls);
      const signUrl = cloudSignUrl ?? (base ? `${base}/sign/${token}` : null);
      if (!signUrl) {
        setLoadError(true);
        return;
      }
      setRemoteUrl(cloudSignUrl ?? null);
      const qr = await QRCode.toDataURL(signUrl, { margin: 1, width: 192 });
      setQrDataUrl(qr);
    } catch {
      setLoadError(true);
    }
  }, [invalidatePending]);

  // (Re)create a session whenever the dialog opens; closing it kills any
  // pending link (locally and its cloud copy).
  useEffect(() => {
    if (!open) {
      return;
    }
    startSession();
    return invalidatePending;
  }, [open, startSession, invalidatePending]);

  // A ficha edit while the link is live invalidates it — the customer would
  // otherwise sign a document that no longer matches the submitted job.
  useEffect(() => {
    if (!(open && qrDataUrl && sessionRef.current && frozenDocRef.current)) {
      return;
    }
    if (canonicalize(document) === frozenDocRef.current) {
      return;
    }
    const token = sessionRef.current;
    sessionRef.current = null;
    frozenDocRef.current = null;
    // Even a delivered signature dies here — it signed the OLD document.
    api.post(`/sign-sessions/${token}/invalidate`).catch(() => undefined);
    setQrDataUrl(null);
    setExpired(true);
  }, [open, qrDataUrl, document]);

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
        if (data.signed && data.signatureDataUrl) {
          clearInterval(poll);
          signedTokenRef.current = token;
          onSignatureRef.current(data.signatureDataUrl, token);
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
  }, [open, qrDataUrl]);

  let content: React.ReactNode;
  if (loadError) {
    content = (
      <p className="py-8 text-center text-error text-sm" role="alert">
        {t("intake.sign_remote_error")}
      </p>
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
                      await navigator.clipboard
                        .writeText(remoteUrl)
                        .catch(() => undefined);
                      setCopied(true);
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

  // Expired can also mean "ficha changed" — the distinction matters to the
  // staff member who just edited a field, so it gets its own state.
  if (expired && !qrDataUrl && !loadError) {
    content = (
      <div className="mt-4 flex flex-col items-center gap-2">
        <p className="text-center text-error text-sm" role="alert">
          {t("intake.sign_remote_invalidated")}
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
  }

  return (
    <Dialog
      description={t("intake.sign_remote_scan")}
      onClose={onClose}
      open={open}
      size="sm"
      title={t("intake.sign_remote_title")}
    >
      <div className="flex flex-col items-center">{content}</div>
    </Dialog>
  );
}
