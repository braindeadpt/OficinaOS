import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionItem } from "@/components/modules/profile/shared";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useModalEffects } from "@/hooks/use-modal-effects";

interface SessionsModalProps {
  loading: boolean;
  onClose: () => void;
  onRevoke: (sessionId: string) => void;
  sessions: SessionItem[];
}

function parseUserAgent(ua: string): string {
  if (ua.includes("Firefox")) {
    return "Firefox";
  }
  if (ua.includes("Edg")) {
    return "Edge";
  }
  if (ua.includes("Chrome")) {
    return "Chrome";
  }
  if (ua.includes("Safari")) {
    return "Safari";
  }
  return ua.slice(0, 30);
}

function SessionSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          className="flex items-center justify-between rounded-lg bg-surface-container-low p-4"
          key={`skel-${String(i)}`}
        >
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-pulse rounded-full bg-surface-container-high" />
            <div className="space-y-1.5">
              <div className="h-4 w-24 animate-pulse rounded bg-surface-container-high" />
              <div className="h-3 w-32 animate-pulse rounded bg-surface-container-highest" />
            </div>
          </div>
          <div className="h-3 w-16 animate-pulse rounded bg-surface-container-high" />
        </div>
      ))}
    </div>
  );
}

function SessionActions({
  isCurrent,
  pendingRevoke,
  onConfirmRevoke,
  onCancelRevoke,
  onRequestRevoke,
  t,
}: {
  isCurrent: boolean;
  onConfirmRevoke: () => void;
  onCancelRevoke: () => void;
  onRequestRevoke: () => void;
  pendingRevoke: boolean;
  t: (key: string) => string;
}) {
  if (isCurrent) {
    return (
      <>
        <span
          aria-label={t("profile_active")}
          className="inline-flex h-2.5 w-2.5 rounded-full bg-success"
          role="status"
        />
        <span className="font-bold text-success text-xs uppercase">
          {t("profile_active")}
        </span>
      </>
    );
  }

  if (pendingRevoke) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-on-surface-variant text-xs">
          {t("profile_revoke_session_confirm")}
        </span>
        <Button
          onClick={onConfirmRevoke}
          size="sm"
          type="button"
          variant="destructive"
        >
          {t("confirm")}
        </Button>
        <Button
          onClick={onCancelRevoke}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("cancel")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      className="text-tertiary"
      onClick={onRequestRevoke}
      size="sm"
      type="button"
      variant="ghost"
    >
      {t("profile_end_session")}
    </Button>
  );
}

export default function SessionsModal({
  loading,
  onClose,
  onRevoke,
  sessions,
}: SessionsModalProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalEffects(true, onClose, dialogRef);

  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        aria-hidden="true"
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby="sessions-modal-title"
        aria-modal="true"
        className="relative z-10 mx-4 flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
        ref={dialogRef}
        role="dialog"
      >
        <div className="bg-surface-container-low px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2
                className="font-bold font-headline text-on-surface text-xl tracking-tight"
                id="sessions-modal-title"
              >
                {t("profile_active_sessions")}
              </h2>
              <p className="mt-0.5 text-on-surface-variant text-sm">
                {t("profile_sessions_count", { count: sessions.length })}
              </p>
            </div>
            <button
              aria-label={t("close")}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              onClick={onClose}
              type="button"
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        </div>

        <div
          aria-busy={loading}
          aria-live="polite"
          aria-relevant="additions text"
          className="flex-1 overflow-y-auto px-6 py-4"
        >
          {loading && <SessionSkeleton />}
          {!loading && sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Icon
                className="mb-2 text-on-surface-variant"
                name="devices"
                size="xl"
              />
              <p className="font-semibold text-on-surface-variant text-sm">
                {t("profile_no_sessions")}
              </p>
              <p className="mt-1 text-on-surface-variant text-xs">
                {t("profile_no_sessions_desc")}
              </p>
            </div>
          )}
          {!loading && sessions.length > 0 && (
            <ul aria-label={t("profile_active_sessions")} className="space-y-3">
              {sessions.map((session) => (
                <li
                  className="flex items-center justify-between rounded-lg bg-surface-container-low p-4"
                  key={session.id}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      aria-hidden
                      className="text-on-surface-variant"
                      name={
                        session.userAgent?.includes("Mobile")
                          ? "smartphone"
                          : "laptop_mac"
                      }
                      size="md"
                    />
                    <div>
                      <p className="font-semibold text-sm">
                        {session.userAgent
                          ? parseUserAgent(session.userAgent)
                          : t("profile_unknown_device")}
                        {session.isCurrent
                          ? ` — ${t("profile_current_session")}`
                          : ""}
                      </p>
                      <p className="text-on-surface-variant text-xs">
                        {session.ipAddress ?? t("profile_unknown_ip")}
                      </p>
                      <p className="mt-0.5 text-on-surface-variant text-xs">
                        {t("profile_login_time")}:{" "}
                        {t("date_short", { val: new Date(session.createdAt) })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SessionActions
                      isCurrent={session.isCurrent}
                      onCancelRevoke={() => setPendingRevoke(null)}
                      onConfirmRevoke={() => {
                        onRevoke(session.id);
                        setPendingRevoke(null);
                      }}
                      onRequestRevoke={() => setPendingRevoke(session.id)}
                      pendingRevoke={pendingRevoke === session.id}
                      t={t}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-surface-container-high border-t px-6 py-4">
          <Button onClick={onClose} type="button" variant="secondary">
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
