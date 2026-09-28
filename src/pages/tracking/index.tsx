import { JobStatus, type JobStatusType, LANGUAGES } from "@shared/constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import api from "@/lib/api";
import { useAuthStore } from "@/stores/auth";

function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  const nextLang = () => {
    const normalizedLang = i18n.language.split("-")[0];
    const currentIdx = LANGUAGES.indexOf(
      normalizedLang as (typeof LANGUAGES)[number]
    );
    const resolvedIdx = currentIdx === -1 ? 0 : currentIdx;
    const next = LANGUAGES[(resolvedIdx + 1) % LANGUAGES.length];
    i18n.changeLanguage(next);
  };

  return (
    <button
      aria-label={t("language_switch")}
      className="material-symbols-outlined min-h-11 min-w-11 rounded-full p-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high"
      onClick={nextLang}
      type="button"
    >
      language
    </button>
  );
}

const HAPPY_PATH_FLOW = [
  JobStatus.INTAKE,
  JobStatus.WAITING_FOR_PARTS,
  JobStatus.IN_REPAIR,
  JobStatus.DONE,
  JobStatus.DELIVERED,
] as const;

const TERMINAL_STATUSES = new Set<string>([
  JobStatus.CANCELLED,
  JobStatus.RETURNED,
  JobStatus.DELIVERED,
]);

interface StatusTransition {
  date: string;
  formattedDate: string;
  from: string | null;
  to: string;
}

interface TrackingData {
  createdAt: string;
  customerName: string;
  device: string;
  estimatedCompletion: string;
  fetchedAt: number;
  formattedFetchedTime: string;
  formattedReceivedDate: string;
  issue: string;
  jobCode: string;
  shopAddress: string;
  shopName: string;
  shopPhone: string;
  status: string;
  statusTransitions: StatusTransition[];
}

function LookupForm({
  initialCode,
  onSearch,
}: {
  initialCode?: string;
  onSearch: (code: string, phone4: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(initialCode ?? "");
  const [phone4, setPhone4] = useState("");

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <nav className="sticky top-0 z-50 w-full bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <img
              alt=""
              aria-hidden="true"
              className="h-8 w-8"
              height={32}
              src="/logo-mark.svg"
              width={32}
            />
            <span className="font-bold font-headline text-2xl text-primary-container tracking-tight">
              OficinaOS
            </span>
          </div>
          <LanguageSwitcher />
        </div>
      </nav>

      <main className="flex flex-grow items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          <div className="overflow-hidden rounded-xl bg-surface-container-low p-8 shadow-sm md:p-12">
            <div className="flex flex-col items-center text-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-highest">
                <span className="material-symbols-outlined text-3xl text-primary-container">
                  build_circle
                </span>
              </div>

              <h1 className="mb-3 font-extrabold font-headline text-3xl text-on-surface tracking-tight md:text-4xl">
                {t("tracking_title")}
              </h1>
              <p className="mb-10 max-w-sm font-body text-lg text-on-surface-variant">
                {t("tracking_subtitle")}
              </p>

              <form
                className="w-full space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim() && phone4.trim()) {
                    onSearch(code.trim(), phone4.trim());
                  }
                }}
              >
                <div className="group relative">
                  <input
                    aria-describedby="job-code-help"
                    aria-label={t("tracking_input_placeholder")}
                    autoCapitalize="off"
                    autoComplete="off"
                    className="h-16 w-full rounded-xl bg-surface-container-highest px-6 font-medium text-lg outline-none transition-all placeholder:text-on-surface-variant/40 focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t("tracking_input_placeholder")}
                    spellCheck={false}
                    type="text"
                    value={code}
                  />
                  <div className="absolute end-4 top-1/2 -translate-y-1/2 text-outline transition-colors group-focus-within:text-primary">
                    <span className="material-symbols-outlined">search</span>
                  </div>
                  <p className="sr-only" id="job-code-help">
                    {t("tracking_input_help")}
                  </p>
                </div>
                <div className="group relative">
                  <input
                    aria-describedby="phone4-help"
                    aria-label={t("tracking_phone4_placeholder")}
                    autoComplete="off"
                    className="h-16 w-full rounded-xl bg-surface-container-highest px-6 font-medium text-lg outline-none transition-all placeholder:text-on-surface-variant/40 focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20"
                    inputMode="numeric"
                    maxLength={4}
                    onChange={(e) =>
                      setPhone4(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder={t("tracking_phone4_placeholder")}
                    type="text"
                    value={phone4}
                  />
                  <div className="absolute end-4 top-1/2 -translate-y-1/2 text-outline transition-colors group-focus-within:text-primary">
                    <span className="material-symbols-outlined">lock</span>
                  </div>
                  <p className="sr-only" id="phone4-help">
                    {t("tracking_phone4_help")}
                  </p>
                </div>
                <button
                  className="flex h-16 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold font-headline text-lg text-on-primary shadow-lg shadow-primary/10 transition-all duration-150 active:opacity-80 disabled:opacity-50"
                  disabled={!(code.trim() && phone4.trim())}
                  type="submit"
                >
                  <span>{t("tracking_track_btn")}</span>
                  <span className="material-symbols-outlined text-xl">
                    arrow_forward
                  </span>
                </button>
              </form>

              <div className="mt-10 w-full bg-surface-container-low pt-8">
                <p className="flex flex-col items-center justify-center gap-1 font-label text-on-surface-variant text-sm sm:flex-row">
                  <span>{t("tracking_no_code")}</span>
                  <span className="font-semibold text-primary">
                    {t("tracking_contact_us")}
                  </span>
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex items-center gap-4 rounded-xl bg-surface-container p-6">
              <div className="rounded-lg bg-surface-container-lowest p-3">
                <span className="material-symbols-outlined text-primary">
                  verified
                </span>
              </div>
              <div className="text-start">
                <p className="font-label text-on-surface-variant text-xs uppercase tracking-widest">
                  {t("tracking_certified_parts")}
                </p>
                <p className="font-bold font-headline text-sm">
                  {t("tracking_oem_components")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-xl bg-surface-container p-6">
              <div className="rounded-lg bg-surface-container-lowest p-3">
                <span className="material-symbols-outlined text-primary">
                  shutter_speed
                </span>
              </div>
              <div className="text-start">
                <p className="font-label text-on-surface-variant text-xs uppercase tracking-widest">
                  {t("tracking_fast_turnaround")}
                </p>
                <p className="font-bold font-headline text-sm">
                  {t("tracking_24h_express")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto w-full bg-surface-container-high py-8">
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <span className="font-body text-on-surface-variant text-xs tracking-wider">
            © {new Date().getFullYear()} OficinaOS.{" "}
            {t("tracking_all_rights_reserved")}
          </span>
        </div>
      </footer>
    </div>
  );
}

function StatusView({
  data,
  onBack,
  onRefresh,
}: {
  data: TrackingData;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const isTerminal = TERMINAL_STATUSES.has(data.status as JobStatusType);
  const isOnHold = data.status === JobStatus.ON_HOLD;
  const isCompleted =
    data.status === JobStatus.DONE || data.status === JobStatus.DELIVERED;
  const isCancelled = data.status === JobStatus.CANCELLED;
  const isReturned = data.status === JobStatus.RETURNED;
  const resolvedIdx = HAPPY_PATH_FLOW.indexOf(
    data.status as (typeof HAPPY_PATH_FLOW)[number]
  );

  let headerBg = "bg-surface-container-highest";
  if (isCompleted) {
    headerBg = "bg-surface-container-high";
  } else if (isCancelled || isReturned) {
    headerBg = "bg-error-container";
  } else if (isOnHold) {
    headerBg = "bg-surface-container-high";
  }

  let pillClass = "bg-primary text-on-primary";
  if (isCancelled || isReturned) {
    pillClass = "bg-error text-on-error";
  }

  let statusHint: string | null = null;
  if (isOnHold) {
    statusHint = t("tracking_status_on_hold_hint");
  } else if (resolvedIdx >= 0 && !isTerminal) {
    statusHint = t("tracking_status_active");
  }

  const statusMessage = (() => {
    if (isCancelled) {
      return (
        <div className="rounded-xl bg-error-container/20 p-6">
          <div className="mb-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-error text-xl">
              cancel
            </span>
            <span className="font-bold text-error text-sm uppercase tracking-wide">
              {t("status.CANCELLED")}
            </span>
          </div>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t("tracking_cancelled_desc")}
          </p>
        </div>
      );
    }
    if (isReturned) {
      return (
        <div className="rounded-xl bg-error-container/20 p-6">
          <div className="mb-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-error text-xl">
              undo
            </span>
            <span className="font-bold text-error text-sm uppercase tracking-wide">
              {t("status.RETURNED")}
            </span>
          </div>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t("tracking_returned_desc")}
          </p>
        </div>
      );
    }
    if (isOnHold) {
      return (
        <div className="rounded-xl bg-surface-container-high p-6">
          <div className="mb-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-xl">
              pause_circle
            </span>
            <span className="font-bold text-primary text-sm uppercase tracking-wide">
              {t("status.ON_HOLD")}
            </span>
          </div>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t("tracking_on_hold_desc")}
          </p>
        </div>
      );
    }
    if (isCompleted) {
      return (
        <div className="rounded-xl bg-primary-container/20 p-6">
          <div className="mb-3 flex items-center gap-3">
            <span
              className="material-symbols-outlined text-primary text-xl"
              style={{ fontVariationSettings: "'wght' 700" }}
            >
              check_circle
            </span>
            <span className="font-bold text-primary text-sm uppercase tracking-wide">
              {t("tracking_ready_title")}
            </span>
          </div>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t("tracking_ready_desc")}
          </p>
        </div>
      );
    }
    return (
      <div className="relative flex flex-col gap-8">
        <div className="absolute start-[11px] top-2 bottom-2 w-[2px] bg-surface-container-high" />
        {HAPPY_PATH_FLOW.map((status, idx) => {
          const transition = data.statusTransitions.find(
            (tr) => tr.to === status
          );
          const isStepCompleted = resolvedIdx >= 0 && idx < resolvedIdx;
          const isStepCurrent = resolvedIdx >= 0 && idx === resolvedIdx;
          const isStepPending = resolvedIdx >= 0 && idx > resolvedIdx;
          return (
            <div
              className="group relative flex items-center gap-6"
              key={status}
            >
              {isStepCompleted && (
                <div className="z-10 flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                  <span
                    className="material-symbols-outlined text-on-primary text-sm"
                    style={{ fontVariationSettings: "'wght' 700" }}
                  >
                    check
                  </span>
                </div>
              )}
              {isStepCurrent && (
                <div className="z-10 flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-primary-container bg-surface-container-lowest ring-4 ring-primary-container/20">
                  <div className="h-2 w-2 rounded-full bg-primary-container" />
                </div>
              )}
              {isStepPending && (
                <div className="z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-outline-variant bg-surface-container-lowest" />
              )}
              <div
                className={`flex flex-col ${isStepPending ? "opacity-50" : ""}`}
              >
                <span
                  className={`font-bold text-sm uppercase tracking-wide ${isStepCurrent ? "text-primary-container" : "text-on-surface"}`}
                >
                  {t(`status.${status}`)}
                </span>
                {isStepCompleted && transition && (
                  <span className="text-on-surface-variant text-xs">
                    {transition.formattedDate}
                  </span>
                )}
                {isStepCurrent && (
                  <span className="text-on-surface-variant text-xs">
                    {t("tracking_step_in_progress")}
                  </span>
                )}
                {isStepPending && (
                  <span className="text-on-surface-variant text-xs">
                    {t("tracking_step_pending")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  })();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <nav className="sticky top-0 z-50 w-full bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <button
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 font-medium text-on-surface-variant text-sm transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
            onClick={onBack}
            type="button"
          >
            <span className="material-symbols-outlined text-lg">
              arrow_back
            </span>
            {t("tracking_new_search")}
          </button>
          <LanguageSwitcher />
        </div>
      </nav>

      <main className="flex flex-grow items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
            <div
              className={`flex items-center justify-between px-8 py-6 ${headerBg}`}
            >
              <div className="flex items-center gap-3">
                <span
                  aria-live="polite"
                  className={`rounded-full px-4 py-1.5 font-bold font-label text-xs uppercase tracking-wide ${pillClass}`}
                >
                  {t(`status.${data.status}`)}
                </span>
                {statusHint && (
                  <span className="font-medium text-on-surface-variant text-sm">
                    {statusHint}
                  </span>
                )}
              </div>
              <div className="text-end">
                <h2 className="font-extrabold font-headline text-lg text-primary-container leading-tight">
                  {t("tracking_received_date", {
                    date: data.formattedReceivedDate,
                  })}
                </h2>
              </div>
            </div>

            <div className="space-y-10 p-8">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="font-label text-on-surface-variant text-xs uppercase tracking-[0.15em]">
                    {t("tracking_device_model")}
                  </p>
                  <p className="font-bold font-headline text-on-surface text-xl">
                    {data.device}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-label text-on-surface-variant text-xs uppercase tracking-[0.15em]">
                    {t("tracking_reported_issue")}
                  </p>
                  <p className="font-bold font-headline text-on-surface text-xl">
                    {data.issue}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-label text-on-surface-variant text-xs uppercase tracking-[0.15em]">
                    {t("tracking_job_reference")}
                  </p>
                  <p className="inline-block rounded bg-surface-container-low px-2 py-1 font-mono font-semibold text-lg text-primary-container">
                    {data.jobCode}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-label text-on-surface-variant text-xs uppercase tracking-[0.15em]">
                    {t("tracking_estimated_completion")}
                  </p>
                  <p className="font-bold font-headline text-lg text-on-surface">
                    {data.estimatedCompletion}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="mb-6 font-label text-on-surface-variant text-xs uppercase tracking-widest">
                  {t("tracking_repair_progress")}
                </h3>

                {statusMessage}
              </div>
            </div>

            <div className="space-y-6 bg-surface-container-low p-8">
              <div className="flex items-start gap-3 rounded-xl bg-surface-container p-4">
                <span className="material-symbols-outlined text-lg text-primary">
                  verified_user
                </span>
                <div>
                  <p className="font-semibold text-sm">
                    {t("tracking_repair_guarantee")}
                  </p>
                  <p className="mt-1 text-on-surface-variant text-xs leading-relaxed">
                    {t("tracking_guarantee_desc")}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-on-surface-variant text-xs">
                  <span className="material-symbols-outlined text-sm">
                    schedule
                  </span>
                  <span>
                    {t("tracking_last_updated", {
                      time: data.formattedFetchedTime,
                    })}
                  </span>
                  <button
                    className="ml-2 rounded-lg px-3 py-2 text-primary text-xs transition-colors hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    onClick={onRefresh}
                    type="button"
                  >
                    {t("tracking_refresh")}
                  </button>
                </div>
                {data.shopPhone && (
                  <a
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-on-primary text-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2"
                    href={`tel:${data.shopPhone}`}
                  >
                    <span className="material-symbols-outlined text-sm">
                      call
                    </span>
                    {t("tracking_contact_shop")}
                  </a>
                )}
              </div>

              {(data.shopName || data.shopAddress) && (
                <div className="flex flex-wrap items-center gap-4 text-on-surface-variant text-xs">
                  {data.shopName && (
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-primary text-sm">
                        storefront
                      </span>
                      <span className="font-medium">{data.shopName}</span>
                    </div>
                  )}
                  {data.shopAddress && (
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">
                        location_on
                      </span>
                      <span>{data.shopAddress}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-auto w-full bg-surface-container-high py-8">
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <span className="font-body text-on-surface-variant text-xs tracking-wider">
            © {new Date().getFullYear()} OficinaOS.{" "}
            {t("tracking_all_rights_reserved")}
          </span>
        </div>
      </footer>
    </div>
  );
}

function mapJobToTrackingData(
  data: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string
): TrackingData {
  const shop = data.shop as {
    name: string;
    phone: string | null;
    address: string | null;
  } | null;
  const statusTransitions = (
    (data.statusTransitions ?? []) as StatusTransition[]
  ).map((tr) => {
    const dateStr = typeof tr.date === "string" ? tr.date : String(tr.date);
    return {
      ...tr,
      date: dateStr,
      formattedDate: new Date(dateStr).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
      }),
    };
  });

  const createdAtStr = data.createdAt as string;
  const formattedReceivedDate = new Date(createdAtStr).toLocaleDateString(
    locale,
    { month: "short", day: "numeric" }
  );

  const estimatedCompletion = data.estimatedDate
    ? new Date(data.estimatedDate as string).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : t("tracking_tbd");

  const now = Date.now();

  return {
    jobCode: data.jobCode as string,
    status: data.status as string,
    device: data.device as string,
    issue: data.reportedProblem as string,
    estimatedCompletion,
    createdAt: createdAtStr,
    formattedReceivedDate,
    customerName: (data.customer as { name: string })?.name ?? "",
    shopName: shop?.name ?? t("app_name"),
    shopPhone: shop?.phone ?? "",
    shopAddress: shop?.address ?? "",
    statusTransitions,
    fetchedAt: now,
    formattedFetchedTime: new Date(now).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export default function TrackingPage() {
  const { jobCode } = useParams<{ jobCode?: string }>();
  const { i18n, t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [trackedJob, setTrackedJob] = useState<TrackingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSearchParams, setLastSearchParams] = useState<{
    code: string;
    phone4: string;
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval>>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const localeRef = useRef(i18n.language);
  localeRef.current = i18n.language;

  const fetchJob = useCallback(
    async (code: string, phone4: string, silent = false) => {
      if (!silent) {
        setIsLoading(true);
      }
      setError(null);
      try {
        const res = await api.get(
          `/jobs/lookup?code=${encodeURIComponent(code)}&phone4=${encodeURIComponent(phone4)}`
        );
        setTrackedJob(
          mapJobToTrackingData(res.data, tRef.current, localeRef.current)
        );
        setLastSearchParams({ code, phone4 });
      } catch (err: unknown) {
        const status =
          err &&
          typeof err === "object" &&
          "response" in err &&
          (err.response as { status?: number })?.status;
        if (status === 429) {
          setError(tRef.current("errors.too_many_attempts"));
        } else {
          setError(tRef.current("tracking_job_not_found"));
        }
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const fetchJobByCodeAuth = useCallback(
    async (code: string, silent = false) => {
      if (!silent) {
        setIsLoading(true);
      }
      setError(null);
      try {
        const res = await api.get(`/jobs/by-code/${encodeURIComponent(code)}`);
        setTrackedJob(
          mapJobToTrackingData(res.data, tRef.current, localeRef.current)
        );
        setLastSearchParams({ code, phone4: "" });
      } catch {
        setError(tRef.current("tracking_job_not_found"));
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const refreshJob = useCallback(() => {
    if (!lastSearchParams) {
      return;
    }
    if (isAuthenticated && !lastSearchParams.phone4) {
      fetchJobByCodeAuth(lastSearchParams.code, true);
    } else {
      fetchJob(lastSearchParams.code, lastSearchParams.phone4, true);
    }
  }, [lastSearchParams, isAuthenticated, fetchJob, fetchJobByCodeAuth]);

  useEffect(() => {
    if (!jobCode) {
      return;
    }
    if (isAuthenticated) {
      fetchJobByCodeAuth(jobCode);
    } else {
      const params = new URLSearchParams(window.location.search);
      const phone4 = params.get("phone4");
      if (phone4) {
        fetchJob(jobCode, phone4);
      }
    }
  }, [jobCode, isAuthenticated, fetchJob, fetchJobByCodeAuth]);

  useEffect(() => {
    if (
      trackedJob &&
      !TERMINAL_STATUSES.has(trackedJob.status as JobStatusType)
    ) {
      pollingRef.current = setInterval(refreshJob, 60_000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
      };
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [trackedJob, refreshJob]);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <nav className="sticky top-0 z-50 w-full bg-background">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <img
                alt=""
                aria-hidden="true"
                className="h-8 w-8"
                height={32}
                src="/logo-mark.svg"
                width={32}
              />
              <span className="font-bold font-headline text-2xl text-primary-container tracking-tight">
                OficinaOS
              </span>
            </div>
            <LanguageSwitcher />
          </div>
        </nav>
        <main className="flex flex-grow items-center justify-center px-4">
          <div className="max-w-sm text-center">
            <span className="material-symbols-outlined mb-4 block text-5xl text-error">
              search_off
            </span>
            <p className="font-bold font-headline text-on-surface text-xl">
              {error}
            </p>
            <p className="mt-2 font-body text-on-surface-variant text-sm">
              {t("tracking_error_hint")}
            </p>
            <button
              className="mt-6 rounded-xl bg-primary px-6 py-3 font-semibold text-on-primary"
              onClick={() => {
                setError(null);
                setTrackedJob(null);
              }}
              type="button"
            >
              {t("tracking_try_again")}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div aria-busy="true" className="flex min-h-dvh flex-col bg-background">
        <nav className="sticky top-0 z-50 w-full bg-background">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <img
                alt=""
                aria-hidden="true"
                className="h-8 w-8"
                height={32}
                src="/logo-mark.svg"
                width={32}
              />
              <span className="font-bold font-headline text-2xl text-primary-container tracking-tight">
                OficinaOS
              </span>
            </div>
            <LanguageSwitcher />
          </div>
        </nav>
        <main className="flex flex-grow items-center justify-center px-4">
          <div aria-live="polite" className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
            <p className="font-body text-on-surface-variant">
              {t("tracking_loading")}
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (trackedJob) {
    return (
      <StatusView
        data={trackedJob}
        onBack={() => {
          setTrackedJob(null);
        }}
        onRefresh={refreshJob}
      />
    );
  }

  return (
    <LookupForm
      initialCode={jobCode}
      onSearch={(code, phone4) => {
        fetchJob(code, phone4);
      }}
    />
  );
}
