import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import api from "@/lib/api";
import { useUiStore } from "@/stores/ui";

interface IntakeRequest {
  code: string;
  createdAt: string;
  customerEmail: string | null;
  customerName: string;
  customerPhone: string;
  deviceLabel: string;
  id: string;
  job: { jobCode: string } | null;
  jobId: string | null;
  problem: string;
  status: "PENDING" | "CONVERTED" | "DISMISSED";
  whatsappOptIn: boolean;
}

type Filter = "PENDING" | "ALL";

export default function RequestsPage() {
  const { t, i18n } = useTranslation();
  const [requests, setRequests] = useState<IntakeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("PENDING");
  const [actingId, setActingId] = useState<string | null>(null);
  const canCreateJob = useCan({ jobs: ["create"] });
  const openIntakeModal = useUiStore((s) => s.openIntakeModal);
  const intakeModalOpen = useUiStore((s) => s.intakeModalOpen);
  const modalOpenedForRequest = useRef(false);

  const load = useCallback(
    async (f: Filter) => {
      setLoading(true);
      try {
        const res = await api.get("/intake-requests", {
          params: f === "PENDING" ? { status: "PENDING" } : {},
        });
        setRequests(res.data ?? []);
      } catch {
        toast.error(t("requests_load_error"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  // When the intake modal we opened closes, refresh — the request may have
  // been converted while the form was up.
  useEffect(() => {
    if (!intakeModalOpen && modalOpenedForRequest.current) {
      modalOpenedForRequest.current = false;
      load(filter);
    }
  }, [intakeModalOpen, filter, load]);

  const dismiss = async (id: string) => {
    setActingId(id);
    try {
      await api.post(`/intake-requests/${id}/dismiss`);
      await load(filter);
    } catch {
      toast.error(t("requests_dismiss_error"));
    } finally {
      setActingId(null);
    }
  };

  // The request form lives at /pre-check — public route served by this app.
  // Plain LAN HTTP is not a secure context, so navigator.clipboard may be
  // unavailable — fall back to a temporary textarea + execCommand.
  const copyPreCheckLink = useCallback(async () => {
    const url = `${window.location.origin}/pre-check`;
    let copied = false;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      copied = document.execCommand("copy");
      ta.remove();
    }
    if (copied) {
      toast.success(t("jobs_detail_track_link_copied"));
    } else {
      toast.error(t("requests_copy_error"));
    }
  }, [t]);

  const createJob = (r: IntakeRequest) => {
    modalOpenedForRequest.current = true;
    openIntakeModal(
      {
        customerEmail: r.customerEmail ?? "",
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        model: r.deviceLabel,
        reportedProblem: r.problem,
      },
      r.id
    );
  };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    }).format(new Date(iso));

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
      </div>
    );
  } else if (requests.length === 0) {
    body = (
      <div className="flex flex-col items-center py-16 text-center">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/40">
          inbox
        </span>
        <p className="mt-4 font-medium text-on-surface-variant">
          {filter === "PENDING"
            ? t("requests_empty_pending")
            : t("requests_empty")}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        {requests.map((r) => (
          <div
            className="rounded-xl bg-surface-container-low p-5 shadow-sm"
            key={r.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-primary-container/20 px-2 py-0.5 font-bold font-mono text-primary-container text-xs">
                    {r.code}
                  </span>
                  <span className="text-on-surface-variant text-xs">
                    {fmtDate(r.createdAt)}
                  </span>
                  {r.whatsappOptIn && (
                    <span className="flex items-center gap-1 rounded-lg bg-tertiary-container/30 px-2 py-0.5 text-on-tertiary-container text-xs">
                      <span className="material-symbols-outlined text-sm">
                        chat
                      </span>
                      {t("requests_whatsapp_optin")}
                    </span>
                  )}
                  {r.status === "CONVERTED" && r.job && (
                    <Link
                      className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs"
                      to={r.jobId ? `/jobs/${r.jobId}` : "/jobs"}
                    >
                      <span className="material-symbols-outlined text-sm">
                        build
                      </span>
                      {r.job.jobCode}
                    </Link>
                  )}
                  {r.status === "DISMISSED" && (
                    <span className="rounded-lg bg-surface-container-highest px-2 py-0.5 text-on-surface-variant text-xs">
                      {t("requests_status_dismissed")}
                    </span>
                  )}
                </div>
                <p className="mt-2 font-bold text-on-surface">
                  {r.customerName}
                  <span className="ms-2 font-normal text-on-surface-variant">
                    {r.customerPhone}
                  </span>
                </p>
                <p className="mt-0.5 font-medium text-on-surface-variant text-sm">
                  {r.deviceLabel}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-on-surface text-sm">
                  {r.problem}
                </p>
              </div>

              {r.status === "PENDING" && (
                <div className="flex shrink-0 items-center gap-2">
                  {canCreateJob && (
                    <button
                      className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-on-primary text-sm transition-all active:scale-[0.98]"
                      onClick={() => createJob(r)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-lg">
                        build_circle
                      </span>
                      {t("requests_create_job")}
                    </button>
                  )}
                  <button
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-highest text-on-surface-variant transition-colors hover:text-error disabled:opacity-50"
                    disabled={actingId === r.id}
                    onClick={() => dismiss(r.id)}
                    title={t("requests_dismiss")}
                    type="button"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("requests_title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm">
            {t("requests_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-surface-container-low p-1">
            {(["PENDING", "ALL"] as const).map((f) => (
              <button
                className={`rounded-lg px-4 py-2 font-medium text-sm transition-colors ${
                  filter === f
                    ? "bg-surface-container-lowest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                key={f}
                onClick={() => setFilter(f)}
                type="button"
              >
                {f === "PENDING"
                  ? t("requests_filter_pending")
                  : t("requests_filter_all")}
              </button>
            ))}
          </div>
          <button
            aria-label={t("requests_copy_link")}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant transition-colors hover:text-on-surface"
            onClick={copyPreCheckLink}
            title={t("requests_copy_link")}
            type="button"
          >
            <span className="material-symbols-outlined">link</span>
          </button>
          <button
            aria-label={t("requests_refresh")}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant transition-colors hover:text-on-surface"
            onClick={() => load(filter)}
            type="button"
          >
            <span className="material-symbols-outlined">refresh</span>
          </button>
        </div>
      </div>

      {body}
    </div>
  );
}
