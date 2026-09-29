import { useTranslation } from "react-i18next";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { REPAIR_CATEGORY_TONES } from "@/lib/category-display";
import type { RepairItem } from "./repair-table";

interface RepairMobileCardProps {
  onEdit: (item: RepairItem) => void;
  onShowDelete: (id: string) => void;
  onToggleActive: (item: RepairItem) => void;
  repair: RepairItem;
  togglingId: string | null;
}

export default function RepairMobileCard({
  onEdit,
  onShowDelete,
  onToggleActive,
  repair,
  togglingId,
}: RepairMobileCardProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();

  return (
    <div className="rounded-xl bg-surface-container-lowest p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${repair.iconBg}`}
          >
            <span
              className={`material-symbols-outlined text-lg ${repair.iconColor}`}
            >
              {repair.icon}
            </span>
          </div>
          <div>
            <h3 className="font-headline font-semibold text-sm">
              {repair.name}
            </h3>
            <span className="font-mono text-on-surface-variant text-xs uppercase tracking-tight">
              {repair.code}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!repair.isActive && (
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 font-medium text-on-surface-variant text-xs">
              {t("inactive")}
            </span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 font-medium text-xs uppercase ${REPAIR_CATEGORY_TONES[repair.category]}`}
          >
            {t(`repair_category.${repair.category}`)}
          </span>
        </div>
      </div>
      <div className="flex items-end justify-between pt-3">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-primary text-sm">
            {fmt(repair.basePrice)}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          aria-label={t("edit_repair", { name: repair.name })}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-on-surface-variant text-xs transition-all hover:bg-surface-container-high hover:text-primary"
          onClick={() => onEdit(repair)}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
          <span>{t("edit")}</span>
        </button>
        <button
          aria-label={
            repair.isActive ? t("deactivate_repair") : t("activate_repair")
          }
          className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-xs transition-all ${
            repair.isActive
              ? "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
              : "text-primary hover:bg-primary-container"
          }`}
          disabled={togglingId === repair.id}
          onClick={() => onToggleActive(repair)}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">
            {repair.isActive ? "toggle_on" : "toggle_off"}
          </span>
          <span>
            {repair.isActive ? t("deactivate_repair") : t("activate_repair")}
          </span>
        </button>
        <button
          aria-label={t("delete_repair")}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-on-surface-variant text-xs transition-all hover:bg-error-container hover:text-on-error-container"
          onClick={() => onShowDelete(repair.id)}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    </div>
  );
}
