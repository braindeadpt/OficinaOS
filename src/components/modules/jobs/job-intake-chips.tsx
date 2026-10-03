import type { Job } from "@shared/types";
import { useTranslation } from "react-i18next";

type ChecklistMap = Job["intakeChecklist"] | Job["qcChecklist"] | undefined;

interface JobIntakeChipsProps {
  accessories: Job["accessories"];
  intakeChecklist: Job["intakeChecklist"];
  qcChecklist?: Job["qcChecklist"];
}

function renderChecklist(
  checklist: ChecklistMap,
  label: string,
  t: (key: string, opts?: Record<string, unknown>) => string
) {
  const checks = Object.entries(
    (checklist ?? {}) as Record<string, "ok" | "fail" | null>
  ).filter((c): c is [string, "ok" | "fail"] => c[1] !== null);
  if (checks.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
        {label}
      </span>
      {checks.map(([item, state]) => (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-label text-xs ${
            state === "ok"
              ? "bg-primary-container/60 text-on-surface"
              : "bg-error-container text-on-error-container"
          }`}
          key={item}
        >
          <span className="material-symbols-outlined text-sm">
            {state === "ok" ? "check" : "close"}
          </span>
          {t(`intake.check_${item}`, { defaultValue: item })}
        </span>
      ))}
    </div>
  );
}

export default function JobIntakeChips({
  accessories,
  intakeChecklist,
  qcChecklist,
}: JobIntakeChipsProps) {
  const { t } = useTranslation();
  const intakeChecks = renderChecklist(
    intakeChecklist,
    t("jobs_detail_checklist"),
    t
  );
  const qcChecks = renderChecklist(qcChecklist, t("jobs_detail_qc"), t);

  if (accessories.length === 0 && !intakeChecks && !qcChecks) {
    return null;
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-outline-variant/30 border-t pt-4">
      {accessories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-label text-[11px] text-on-surface-variant uppercase tracking-widest">
            {t("jobs_detail_accessories")}
          </span>
          {accessories.map((a) => (
            <span
              className="rounded-full bg-surface-container-highest px-3 py-1 font-label text-on-surface text-xs"
              key={a}
            >
              {t(`intake.accessory_${a}`, { defaultValue: a })}
            </span>
          ))}
        </div>
      )}
      {intakeChecks}
      {qcChecks}
    </div>
  );
}
