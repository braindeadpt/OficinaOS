import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ListClaimsParams } from "@/types/return-claim";

interface Props {
  onChange: (next: ListClaimsParams) => void;
  value: ListClaimsParams;
}

export default function ClaimsFilters({ value, onChange }: Props) {
  const { t } = useTranslation();

  const set = <K extends keyof ListClaimsParams>(
    key: K,
    v: ListClaimsParams[K]
  ) => onChange({ ...value, [key]: v, page: 1 });

  const selectCls =
    "rounded-xl border-none bg-surface-container-highest px-4 py-3.5 text-sm transition-all focus:bg-surface-container-lowest";

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium text-on-surface-variant text-xs uppercase tracking-wide">
          {t("returns_filter_status")}
        </span>
        <select
          aria-label={t("returns_filter_status")}
          className={selectCls}
          onChange={(e) =>
            set(
              "status",
              (e.target.value || undefined) as ListClaimsParams["status"]
            )
          }
          value={value.status ?? ""}
        >
          <option value="">—</option>
          <option value="OPEN">{t("returns_status_open")}</option>
          <option value="RESOLVED">{t("returns_status_resolved")}</option>
        </select>
      </label>

      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium text-on-surface-variant text-xs uppercase tracking-wide">
          {t("returns_filter_fault")}
        </span>
        <select
          aria-label={t("returns_filter_fault")}
          className={selectCls}
          onChange={(e) =>
            set(
              "faultCategory",
              (e.target.value || undefined) as ListClaimsParams["faultCategory"]
            )
          }
          value={value.faultCategory ?? ""}
        >
          <option value="">—</option>
          <option value="WORKMANSHIP">{t("returns_fault_workmanship")}</option>
          <option value="DEFECTIVE_PART">
            {t("returns_fault_defective_part")}
          </option>
          <option value="MISDIAGNOSIS">
            {t("returns_fault_misdiagnosis")}
          </option>
        </select>
      </label>

      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium text-on-surface-variant text-xs uppercase tracking-wide">
          {t("returns_filter_outcome")}
        </span>
        <select
          aria-label={t("returns_filter_outcome")}
          className={selectCls}
          onChange={(e) =>
            set(
              "resolutionOutcome",
              (e.target.value ||
                undefined) as ListClaimsParams["resolutionOutcome"]
            )
          }
          value={value.resolutionOutcome ?? ""}
        >
          <option value="">—</option>
          <option value="REWORK_FREE">
            {t("returns_outcome_rework_free")}
          </option>
          <option value="REWORK_PARTIAL_CHARGE">
            {t("returns_outcome_rework_partial_charge")}
          </option>
          <option value="REFUND_PARTIAL">
            {t("returns_outcome_refund_partial")}
          </option>
          <option value="REFUND_FULL">
            {t("returns_outcome_refund_full")}
          </option>
        </select>
      </label>

      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium text-on-surface-variant text-xs uppercase tracking-wide">
          {t("returns_filter_from")}
        </span>
        <input
          aria-label={t("returns_filter_from")}
          className={selectCls}
          onChange={(e) =>
            set(
              "from",
              e.target.value
                ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString()
                : undefined
            )
          }
          type="date"
          value={value.from ? value.from.slice(0, 10) : ""}
        />
      </label>

      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium text-on-surface-variant text-xs uppercase tracking-wide">
          {t("returns_filter_to")}
        </span>
        <input
          aria-label={t("returns_filter_to")}
          className={selectCls}
          onChange={(e) =>
            set(
              "to",
              e.target.value
                ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString()
                : undefined
            )
          }
          type="date"
          value={value.to ? value.to.slice(0, 10) : ""}
        />
      </label>

      <Button
        onClick={() => onChange({ page: 1, limit: 20 })}
        size="sm"
        type="button"
        variant="ghost"
      >
        {t("returns_filter_clear")}
      </Button>
    </div>
  );
}
