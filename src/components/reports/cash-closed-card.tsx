import type { CashReportDTO, CashSessionDTO } from "@shared/types/reports";
import { useTranslation } from "react-i18next";

interface CashClosedCardProps {
  onReopen: () => Promise<void>;
  session: CashSessionDTO & { liveReport: CashReportDTO };
}

function divergenceClass(value: number | null): string {
  if (value === null || value === 0) {
    return "text-on-surface-variant";
  }
  return value > 0 ? "text-primary" : "text-error";
}

function fmtDateTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Read-only view of a closed cash session: the frozen close-time figures,
 * the counted cash vs system cash divergence, the cashier's note and
 * signature, and an explicit reopen action (which clears the signature
 * and is recorded on the session's audit trail).
 */
export default function CashClosedCard({
  session,
  onReopen,
}: CashClosedCardProps) {
  const { t } = useTranslation();
  const { counted, divergence, report } = session;

  const divergenceValue = divergence.cash;

  async function handleReopen() {
    await onReopen();
  }

  return (
    <div
      className="rounded-2xl bg-surface-container-low p-5"
      data-testid="cash-closed-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold font-headline text-on-surface">
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-primary text-xl"
            >
              task_alt
            </span>
            {t("reports.cashClosedTitle")}
          </h3>
          <p className="mt-1 text-on-surface-variant text-sm">
            {t("reports.cashClosedBy", {
              name: session.closedBy?.name ?? "—",
              at: fmtDateTime(session.closedAt),
            })}
          </p>
        </div>
        <button
          className="min-h-[44px] rounded-xl bg-surface-container-highest px-4 py-2 font-bold font-headline text-on-secondary-fixed-variant text-sm hover:bg-surface-container active:scale-[0.98]"
          data-testid="cash-reopen"
          onClick={handleReopen}
          type="button"
        >
          {t("reports.cashReopen")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-surface-container-lowest p-3">
          <p className="font-label text-on-surface-variant text-xs uppercase tracking-wide">
            {t("reports.cashCountedCash")}
          </p>
          <p className="mt-1 font-bold font-headline text-lg text-on-surface tabular-nums">
            {(counted.cash ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-3">
          <p className="font-label text-on-surface-variant text-xs uppercase tracking-wide">
            {t("reports.cashClosedSystemCash")}
          </p>
          <p className="mt-1 font-bold font-headline text-lg text-on-surface tabular-nums">
            {report.summary.cashTotal.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-surface-container-lowest p-3">
          <p className="font-label text-on-surface-variant text-xs uppercase tracking-wide">
            {t("reports.cashDivergence")}
          </p>
          <p
            className={`mt-1 font-bold font-headline text-lg tabular-nums ${divergenceClass(divergenceValue)}`}
            data-testid="cash-divergence-value"
          >
            {(divergenceValue ?? 0) > 0 ? "+" : ""}
            {(divergenceValue ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {session.note && (
        <p className="mt-3 text-on-surface-variant text-sm">
          <span className="font-bold font-label text-xs uppercase tracking-wide">
            {t("reports.cashCloseNote")}:{" "}
          </span>
          {session.note}
        </p>
      )}

      {session.signatureDataUrl && (
        <div className="mt-3">
          <p className="mb-1 font-bold font-label text-on-surface-variant text-xs uppercase tracking-wide">
            {t("reports.cashSignature")}
          </p>
          <img
            alt={t("reports.cashSignatureAlt")}
            className="h-24 rounded-lg bg-surface-container-lowest"
            height={128}
            src={session.signatureDataUrl}
            width={288}
          />
        </div>
      )}

      {session.reopenCount > 0 && (
        <p className="mt-3 text-on-surface-variant text-xs">
          {t("reports.cashReopenCount", { count: session.reopenCount })}
        </p>
      )}
    </div>
  );
}
