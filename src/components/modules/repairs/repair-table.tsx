import { useTranslation } from "react-i18next";
import { useFormatCurrency } from "@/hooks/use-format-currency";

export type RepairCategory = "HARDWARE" | "SOFTWARE" | "DIAGNOSTIC";

export interface RepairItem {
  basePrice: number;
  category: RepairCategory;
  code: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  id: string;
  isActive: boolean;
  name: string;
}

export const CATEGORY_COLORS: Record<RepairCategory, string> = {
  HARDWARE: "bg-secondary-container text-on-secondary-container",
  SOFTWARE: "bg-tertiary-fixed text-on-tertiary-fixed",
  DIAGNOSTIC: "bg-primary-fixed text-on-primary-fixed",
};

interface RepairTableProps {
  onEdit: (item: RepairItem) => void;
  onShowDelete: (id: string) => void;
  onToggleActive: (item: RepairItem) => void;
  repairs: RepairItem[];
  togglingId: string | null;
}

export default function RepairTable({
  onEdit,
  onShowDelete,
  onToggleActive,
  repairs,
  togglingId,
}: RepairTableProps) {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();

  return (
    <div className="overflow-hidden rounded-2xl bg-surface-container-low">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] border-collapse text-start">
          <thead>
            <tr className="bg-surface-container-high/30">
              <th
                className="p-4 font-body font-medium text-on-surface-variant text-xs uppercase tracking-widest"
                scope="col"
              >
                {t("repair_name")}
              </th>
              <th
                className="p-4 font-body font-medium text-on-surface-variant text-xs uppercase tracking-widest"
                scope="col"
              >
                {t("category")}
              </th>
              <th
                className="p-4 font-body font-medium text-on-surface-variant text-xs uppercase tracking-widest"
                scope="col"
              >
                {t("base_price")}
              </th>
              <th
                className="p-4 font-body font-medium text-on-surface-variant text-xs uppercase tracking-widest"
                scope="col"
              >
                {t("status_label")}
              </th>
              <th aria-label={t("actions")} className="p-4" scope="col" />
            </tr>
          </thead>
          <tbody>
            {repairs.map((repair) => (
              <tr
                className="transition-colors even:bg-surface-container-lowest/50 hover:bg-surface-container-lowest"
                key={repair.id}
              >
                <td className="p-4">
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
                      <p className="font-headline font-medium text-sm">
                        {repair.name}
                      </p>
                      <p className="font-mono text-on-surface-variant text-xs uppercase tracking-tight">
                        {repair.code}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <span
                    className={`rounded-full px-3 py-1 font-medium text-xs uppercase ${CATEGORY_COLORS[repair.category]}`}
                  >
                    {t(`repair_category.${repair.category}`)}
                  </span>
                </td>
                <td className="p-4">
                  <span className="font-mono font-semibold text-sm">
                    {fmt(repair.basePrice)}
                  </span>
                </td>
                <td className="p-4">
                  {!repair.isActive && (
                    <span className="rounded-full bg-surface-container-high px-2.5 py-1 font-medium text-on-surface-variant text-xs">
                      {t("inactive")}
                    </span>
                  )}
                  {repair.isActive && (
                    <span className="rounded-full bg-primary-container px-2.5 py-1 font-medium text-on-primary-container text-xs">
                      {t("active")}
                    </span>
                  )}
                </td>
                <td className="p-4 text-end">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      aria-label={t("edit_repair", { name: repair.name })}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                      onClick={() => onEdit(repair)}
                      title={t("edit_repair", { name: repair.name })}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        edit
                      </span>
                    </button>
                    <button
                      aria-label={
                        repair.isActive
                          ? t("deactivate_repair")
                          : t("activate_repair")
                      }
                      className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${repair.isActive ? "text-on-surface-variant hover:bg-surface-container-high hover:text-primary" : "text-primary hover:bg-primary-container"}`}
                      disabled={togglingId === repair.id}
                      onClick={() => onToggleActive(repair)}
                      title={
                        repair.isActive
                          ? t("deactivate_repair")
                          : t("activate_repair")
                      }
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {repair.isActive ? "toggle_on" : "toggle_off"}
                      </span>
                    </button>
                    <button
                      aria-label={t("delete_repair")}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                      onClick={() => onShowDelete(repair.id)}
                      title={t("delete_repair")}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        delete
                      </span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
