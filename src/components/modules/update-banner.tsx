import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

interface UpdateStatus {
  detail: string;
  state: string;
}

interface UpdateState {
  canSelfUpdate: boolean;
  installMode: string;
  latest: string | null;
  releaseUrl: string | null;
  status: UpdateStatus;
  updateAvailable: boolean;
}

const POLL_MS = 3000;
// The server goes away while the updater swaps files — keep polling through
// the outage for this long before declaring failure.
const DEADLINE_MS = 10 * 60 * 1000;
const PHASE_KEY: Record<string, string> = {
  downloading: "update_phase_downloading",
  starting: "update_phase_starting",
  backing_up: "update_phase_backing_up",
  stopping: "update_phase_stopping",
  applying: "update_phase_applying",
  restarting: "update_phase_restarting",
  rolling_back: "update_phase_rolling_back",
};

// One-shot check on mount, OWNER only. Dismissal is per-version so the
// banner comes back when the next release ships.
export default function UpdateBanner() {
  const role = useAuthStore((s) => s.role);
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (role !== "OWNER") {
      return;
    }
    let cancelled = false;
    api
      .get<UpdateState>("/settings/update-check")
      .then((res) => {
        if (cancelled) {
          return;
        }
        const { latest, updateAvailable, status } = res.data;
        // A previous update attempt left a status worth showing — but only
        // until the user acks it (else the "reload" prompt would loop).
        if (
          status?.state === "done" &&
          !localStorage.getItem(`update-done:${latest}`)
        ) {
          setInfo(res.data);
          setBusy(true);
          return;
        }
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
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
      }
    };
  }, [role]);

  const startPolling = () => {
    const deadline = Date.now() + DEADLINE_MS;
    pollTimer.current = setInterval(() => {
      if (Date.now() > deadline) {
        if (pollTimer.current) {
          clearInterval(pollTimer.current);
        }
        setInfo((prev) =>
          prev
            ? {
                ...prev,
                status: { state: "failed", detail: "timeout" },
              }
            : prev
        );
        return;
      }
      api
        .get<UpdateState>("/settings/update/status")
        .then((res) => {
          setInfo((prev) => ({ ...(prev ?? res.data), ...res.data }));
          const s = res.data.status.state;
          if (
            (s === "done" || s === "failed" || s === "rolled_back") &&
            pollTimer.current
          ) {
            clearInterval(pollTimer.current);
          }
        })
        .catch(() => {
          // Server down mid-swap is expected — keep polling until deadline.
        });
    }, POLL_MS);
  };

  const startUpdate = () => {
    setBusy(true);
    api
      .post("/settings/update")
      .then(() => startPolling())
      .catch(() => {
        setBusy(false);
      });
  };

  if (!info) {
    return null;
  }
  const { status } = info;
  const latest = info.latest ?? "";

  const dismiss = () => {
    localStorage.setItem(`update-dismissed:${latest}`, "1");
    setInfo(null);
  };

  let body: string;
  if (status.state === "done") {
    body = t("update_done_title", { version: latest });
  } else if (status.state === "failed") {
    body = `${t("update_failed_title")}${status.detail ? ` — ${status.detail}` : ""}`;
  } else if (status.state === "rolled_back") {
    body = t("update_rolled_back_title");
  } else if (busy || PHASE_KEY[status.state]) {
    body = t(PHASE_KEY[status.state] ?? "update_phase_starting");
  } else {
    body = "";
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl bg-tertiary-container px-4 py-3">
      <Icon
        className="shrink-0 text-on-tertiary-container"
        name="system_update_alt"
        size="sm"
      />
      <p className="min-w-0 flex-1 text-on-tertiary-container text-sm">
        <span className="font-semibold">
          {status.state === "idle" &&
            t("update_available_title", { version: latest })}
        </span>{" "}
        <span className="text-on-tertiary-container/80">
          {body || (info.canSelfUpdate ? "" : t("update_available_hint"))}
        </span>
      </p>
      {status.state === "done" && (
        <button
          className="shrink-0 rounded-lg bg-on-tertiary-container px-3 py-1.5 font-medium text-sm text-tertiary-container"
          onClick={() => {
            localStorage.setItem(`update-done:${latest}`, "1");
            window.location.reload();
          }}
          type="button"
        >
          {t("update_reload_button")}
        </button>
      )}
      {info.updateAvailable &&
        info.canSelfUpdate &&
        status.state === "idle" && (
          <button
            className="shrink-0 rounded-lg bg-on-tertiary-container px-3 py-1.5 font-medium text-sm text-tertiary-container disabled:opacity-60"
            disabled={busy}
            onClick={startUpdate}
            type="button"
          >
            {t("update_now_button")}
          </button>
        )}
      {info.releaseUrl && status.state === "idle" && (
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
