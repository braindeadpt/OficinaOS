import type { CashReportDTO, CashSessionDTO } from "@shared/types/reports";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReportsStore } from "@/stores/reports";
import SignaturePad from "./signature-pad";

interface CashCloseCardProps {
  onClosed: () => void;
  session: CashSessionDTO & { liveReport: CashReportDTO };
}

function previewClass(preview: number): string {
  if (preview === 0) {
    return "text-on-surface-variant";
  }
  return preview > 0 ? "text-primary" : "text-error";
}

/**
 * Close-the-day form: cash count (and optional non-cash recount and
 * grand total), optional note and a drawn signature. Divergence preview
 * (counted − system cash) updates as the cashier types, and the computed
 * divergence is shown server-side again on the frozen session after close.
 */
export default function CashCloseCard({
  session,
  onClosed,
}: CashCloseCardProps) {
  const { t } = useTranslation();
  const closeCashSession = useReportsStore((s) => s.closeCashSession);
  const [countedCash, setCountedCash] = useState("");
  const [countedNonCash, setCountedNonCash] = useState("");
  const [countedTotal, setCountedTotal] = useState("");
  const [note, setNote] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const systemCash = session.liveReport.summary.cashTotal;
  const cashValue = Number(countedCash);
  const hasCash = countedCash.trim() !== "" && Number.isFinite(cashValue);
  const preview = hasCash ? cashValue - systemCash : null;

  const handleSubmit = useCallback(async () => {
    if (!hasCash) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await closeCashSession({
        countedCash: cashValue,
        countedNonCash:
          countedNonCash.trim() === "" ? undefined : Number(countedNonCash),
        countedTotalCollected:
          countedTotal.trim() === "" ? undefined : Number(countedTotal),
        note: note.trim() || undefined,
        signatureDataUrl: signature ?? undefined,
      });
      onClosed();
    } catch {
      setError(t("reports.cashCloseError"));
    } finally {
      setSubmitting(false);
    }
  }, [
    hasCash,
    cashValue,
    countedNonCash,
    countedTotal,
    note,
    signature,
    closeCashSession,
    onClosed,
    t,
  ]);

  return (
    <div className="rounded-2xl bg-surface-container-low p-5">
      <h3 className="font-bold font-headline text-on-surface">
        {t("reports.cashCloseTitle")}
      </h3>
      <p className="mt-1 text-on-surface-variant text-sm">
        {t("reports.cashCloseSystemCash", {
          amount: systemCash.toLocaleString(),
        })}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label
            className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
            htmlFor="cash-counted-cash"
          >
            {t("reports.cashCountedCash")}
          </label>
          <input
            className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
            id="cash-counted-cash"
            inputMode="decimal"
            min="0"
            onChange={(e) => setCountedCash(e.target.value)}
            type="number"
            value={countedCash}
          />
        </div>
        <div>
          <label
            className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
            htmlFor="cash-counted-noncash"
          >
            {t("reports.cashCountedNonCash")}
          </label>
          <input
            className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
            id="cash-counted-noncash"
            inputMode="decimal"
            min="0"
            onChange={(e) => setCountedNonCash(e.target.value)}
            type="number"
            value={countedNonCash}
          />
        </div>
        <div>
          <label
            className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
            htmlFor="cash-counted-total"
          >
            {t("reports.cashCountedTotal")}
          </label>
          <input
            className="h-12 w-full rounded-xl bg-surface-container-highest px-4 text-on-surface focus:ring-2 focus:ring-primary"
            id="cash-counted-total"
            inputMode="decimal"
            onChange={(e) => setCountedTotal(e.target.value)}
            type="number"
            value={countedTotal}
          />
        </div>
      </div>

      {preview !== null && (
        <p
          className={`mt-3 font-medium text-sm ${previewClass(preview)}`}
          data-testid="cash-divergence-preview"
        >
          {t("reports.cashDivergencePreview", {
            amount: preview.toLocaleString(),
          })}
        </p>
      )}

      <div className="mt-3">
        <label
          className="mb-1.5 block font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide"
          htmlFor="cash-close-note"
        >
          {t("reports.cashCloseNote")}
        </label>
        <textarea
          className="min-h-20 w-full rounded-xl bg-surface-container-highest p-3 text-on-surface focus:ring-2 focus:ring-primary"
          id="cash-close-note"
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          value={note}
        />
      </div>

      <div className="mt-3">
        <p className="mb-1.5 font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide">
          {t("reports.cashSignature")}
        </p>
        <SignaturePad onChange={setSignature} />
      </div>

      {error && (
        <div className="mt-2" role="alert">
          <p className="font-body text-error text-xs">{error}</p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-on-surface-variant text-xs">
          {t("reports.cashCloseDisclaimer")}
        </p>
        <button
          className="min-h-[44px] shrink-0 rounded-xl bg-primary px-6 py-2 font-bold font-headline text-on-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="cash-close-submit"
          disabled={!hasCash || submitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitting
            ? "..."
            : t("reports.cashCloseConfirm", {
                amount: hasCash ? cashValue.toLocaleString() : "",
              })}
        </button>
      </div>
    </div>
  );
}
