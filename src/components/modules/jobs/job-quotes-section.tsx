import type { QuoteStatusType } from "@shared/constants";
import type { JobQuote } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Can } from "@/components/modules/can";
import SendQuoteDialog from "@/components/modules/jobs/send-quote-dialog";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { useJobsStore } from "@/stores/jobs";

const QUOTE_BADGE_CLASS: Record<QuoteStatusType, string> = {
  SENT: "bg-primary-container/40 text-primary",
  APPROVED: "bg-primary text-on-primary",
  REJECTED: "bg-error-container text-error",
  SUPERSEDED: "bg-surface-container-high text-on-surface-variant",
};

interface JobQuotesSectionProps {
  estimatedCost: number | null;
  jobId: string;
  onChanged: () => void;
}

export default function JobQuotesSection({
  estimatedCost,
  jobId,
  onChanged,
}: JobQuotesSectionProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [quotes, setQuotes] = useState<JobQuote[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchQuotes = useCallback(async () => {
    try {
      const result = await useJobsStore.getState().fetchQuotes(jobId);
      setQuotes(result);
    } catch {
      // Section stays empty; job detail already surfaces global errors.
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  const handleSent = useCallback(async () => {
    await fetchQuotes();
    onChanged();
  }, [fetchQuotes, onChanged]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-bold font-headline text-base text-on-surface">
          {t("quotes.section_title")}
        </h2>
        <Can perm={{ jobs: ["edit"] }}>
          <button
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-primary transition-colors hover:bg-primary/10"
            onClick={() => setShowSendDialog(true)}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">
              request_quote
            </span>
            <span className="font-label text-xs">{t("quotes.send")}</span>
          </button>
        </Can>
      </div>

      {!isLoading && quotes.length > 0 && (
        <ul className="mt-3 divide-y divide-outline-variant">
          {quotes.map((q) => (
            <li className="flex items-start gap-3 py-2.5" key={q.id}>
              <span className="material-symbols-outlined pt-0.5 text-[18px] text-on-surface-variant">
                request_quote
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-body font-semibold text-on-surface text-sm">
                  {t("quotes.version_label", { version: q.version })} ·{" "}
                  {fmt(Number(q.amount))}
                </p>
                {q.note && (
                  <p className="truncate font-label text-on-surface-variant text-xs">
                    {q.note}
                  </p>
                )}
                {q.responseNote && (
                  <p className="truncate font-label text-on-surface-variant text-xs">
                    {t("quotes.response_note")}: {q.responseNote}
                  </p>
                )}
                <p className="font-label text-on-surface-variant text-xs">
                  {new Date(q.sentAt).toLocaleString()}
                  {q.respondedAt &&
                    ` · ${t("quotes.responded_at", { time: new Date(q.respondedAt).toLocaleString() })}`}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 font-extrabold text-xs uppercase tracking-wider ${QUOTE_BADGE_CLASS[q.status as QuoteStatusType] ?? QUOTE_BADGE_CLASS.SUPERSEDED}`}
              >
                {t(`quotes.status.${q.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && quotes.length === 0 && (
        <p className="mt-2 font-body text-on-surface-variant text-sm">
          {t("quotes.empty")}
        </p>
      )}

      <SendQuoteDialog
        defaultAmount={estimatedCost}
        jobId={jobId}
        onClose={() => setShowSendDialog(false)}
        onSent={handleSent}
        open={showSendDialog}
      />
    </div>
  );
}
