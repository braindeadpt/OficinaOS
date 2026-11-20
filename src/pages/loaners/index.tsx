import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import LoanerDeviceModal from "@/components/modules/loaners/loaner-device-modal";
import ConfirmDiscardDialog from "@/components/ui/confirm-discard-dialog";
import { Icon } from "@/components/ui/icon";
import { useCan } from "@/hooks/use-can";
import {
  fetchLoanerDevices,
  type LoanerDevice,
  type LoanerStatus,
  markLoanerReturned,
  updateLoanerDevice,
} from "@/lib/api-loaners";

const FILTERS: (LoanerStatus | "")[] = ["", "out", "available", "retired"];
const STATUS_BADGE: Record<LoanerStatus, string> = {
  available: "bg-primary-container text-on-primary-container",
  out: "bg-tertiary-container text-on-tertiary-container",
  retired: "bg-surface-container-high text-on-surface-variant",
};
const SKELETON_ROWS = ["r1", "r2", "r3"];

function deviceSpec(d: LoanerDevice): string {
  return [d.brand, d.model].filter(Boolean).join(" ");
}

function fmtDate(iso: string | null | undefined, locale: string): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleDateString(locale);
}

export default function LoanersPage() {
  const { i18n, t } = useTranslation();
  const canManage = useCan({ loaners: ["manage"] });
  const canReturn = useCan({ loaners: ["return"] });
  const [filter, setFilter] = useState<LoanerStatus | "">("");
  const [devices, setDevices] = useState<LoanerDevice[] | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoanerDevice | "new" | null>(null);
  const [confirmReturn, setConfirmReturn] = useState<LoanerDevice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await fetchLoanerDevices());
      setError(null);
    } catch {
      setError(t("loaners.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (d: LoanerDevice) => {
    setBusyId(d.id);
    setError(null);
    try {
      await updateLoanerDevice(d.id, { active: !d.active });
      await load();
    } catch {
      setError(t("loaners.save_failed"));
    } finally {
      setBusyId(null);
    }
  };

  const doReturn = async () => {
    const device = confirmReturn;
    if (!device) {
      return;
    }
    setConfirmReturn(null);
    setBusyId(device.id);
    setError(null);
    try {
      await markLoanerReturned(device.id);
      await load();
    } catch {
      setError(t("loaners.return_failed"));
    } finally {
      setBusyId(null);
    }
  };

  const shown = devices?.filter((d) => !filter || d.status === filter) ?? [];
  const isEmpty = !isLoading && shown.length === 0;

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("loaners.title")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("loaners.subtitle")}
          </p>
        </div>
        {canManage && (
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold font-headline text-on-primary text-sm transition-colors hover:bg-primary-container hover:text-on-primary-container"
            onClick={() => setEditing("new")}
            type="button"
          >
            <Icon name="add" size="sm" />
            {t("loaners.new")}
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            className={`rounded-full px-4 py-1.5 font-label text-sm transition-colors ${
              filter === f
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            }`}
            key={f || "all"}
            onClick={() => setFilter(f)}
            type="button"
          >
            {t(f ? `loaners.status_${f}` : "loaners.filter_all")}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-error-container px-4 py-3 text-on-error-container text-sm">
          {error}
        </p>
      )}

      {isEmpty && !isLoading && (
        <div
          className="flex flex-col items-center justify-center py-16"
          role="status"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-low">
            <Icon
              className="text-on-surface-variant"
              name="phone_iphone"
              size="xl"
            />
          </div>
          <p className="font-bold font-headline text-lg text-on-surface">
            {t("loaners.empty_title")}
          </p>
          <p className="mt-1 text-on-surface-variant text-sm">
            {t("loaners.empty_desc")}
          </p>
        </div>
      )}

      {!isEmpty && (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-outline-variant border-b font-label text-on-surface-variant text-xs uppercase tracking-wider">
                <th className="px-5 py-3">{t("loaners.col_label")}</th>
                <th className="px-5 py-3">{t("loaners.col_status")}</th>
                <th className="px-5 py-3">{t("loaners.col_holder")}</th>
                <th className="px-5 py-3 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                SKELETON_ROWS.map((row) => (
                  <tr className="border-outline-variant/40 border-b" key={row}>
                    {["c1", "c2", "c3", "c4"].map((col) => (
                      <td className="px-5 py-4" key={col}>
                        <div className="h-3 w-24 animate-pulse rounded bg-surface-container-high" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!isLoading &&
                shown.map((d) => {
                  const loan = d.currentLoan;
                  const overdue =
                    loan?.estimatedDate &&
                    new Date(loan.estimatedDate).getTime() < Date.now();
                  return (
                    <tr
                      className="border-outline-variant/40 border-b last:border-0"
                      key={d.id}
                    >
                      <td className="px-5 py-4">
                        <p className="font-bold font-headline text-on-surface">
                          {d.label}
                        </p>
                        <p className="text-on-surface-variant text-xs">
                          {[deviceSpec(d), d.imei ? `IMEI ${d.imei}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-extrabold text-xs uppercase tracking-wider ${STATUS_BADGE[d.status]}`}
                        >
                          {t(`loaners.status_${d.status}`)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {loan ? (
                          <>
                            <p className="font-medium text-on-surface">
                              <Link
                                className="text-primary hover:underline"
                                to={`/jobs/${loan.id}`}
                              >
                                {loan.jobCode}
                              </Link>
                              {" — "}
                              {loan.customer.name}
                            </p>
                            <p
                              className={`text-xs ${
                                overdue
                                  ? "font-semibold text-error"
                                  : "text-on-surface-variant"
                              }`}
                            >
                              {t("loaners.since", {
                                date: fmtDate(loan.createdAt, i18n.language),
                              })}
                              {loan.estimatedDate &&
                                ` · ${t("loaners.expected_return", {
                                  date: fmtDate(
                                    loan.estimatedDate,
                                    i18n.language
                                  ),
                                })}`}
                              {overdue && ` · ${t("loaners.overdue")}`}
                            </p>
                          </>
                        ) : (
                          <span className="text-on-surface-variant text-xs">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          {d.status === "out" && canReturn && (
                            <button
                              className="rounded-lg p-2 text-primary transition-colors hover:bg-surface-container disabled:opacity-50"
                              disabled={busyId === d.id}
                              onClick={() => setConfirmReturn(d)}
                              title={t("loaners.action_return")}
                              type="button"
                            >
                              <Icon name="assignment_return" size="sm" />
                            </button>
                          )}
                          {loan && (
                            <button
                              className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container"
                              onClick={() =>
                                window.open(
                                  `/api/receipts/${loan.id}/loaner-agreement`,
                                  "_blank"
                                )
                              }
                              title={t("loaners.action_agreement")}
                              type="button"
                            >
                              <Icon name="description" size="sm" />
                            </button>
                          )}
                          {canManage && (
                            <button
                              className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container"
                              onClick={() => setEditing(d)}
                              title={t("edit")}
                              type="button"
                            >
                              <Icon name="edit" size="sm" />
                            </button>
                          )}
                          {canManage && d.status !== "out" && (
                            <button
                              className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
                              disabled={busyId === d.id}
                              onClick={() => toggleActive(d)}
                              title={
                                d.active
                                  ? t("loaners.action_retire")
                                  : t("loaners.action_reactivate")
                              }
                              type="button"
                            >
                              <Icon
                                name={
                                  d.active ? "visibility_off" : "visibility"
                                }
                                size="sm"
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {confirmReturn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <button
            aria-label={t("cancel")}
            className="absolute inset-0 bg-overlay"
            onClick={() => setConfirmReturn(null)}
            type="button"
          />
          <ConfirmDiscardDialog
            description={t("loaners.confirm_return_desc", {
              label: confirmReturn.label,
            })}
            discardLabel={t("loaners.confirm_return_yes")}
            keepLabel={t("cancel")}
            onDiscard={doReturn}
            onKeepEditing={() => setConfirmReturn(null)}
            open={true}
            title={t("loaners.confirm_return_title")}
          />
        </div>
      )}

      {editing && (
        <LoanerDeviceModal
          device={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}
