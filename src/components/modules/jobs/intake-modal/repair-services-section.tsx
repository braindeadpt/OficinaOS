import type { RepairCatalog } from "@shared/types";
import RepairServicePicker from "@/components/modules/jobs/repair-service-picker";
import type { SelectedRepair } from "./types";

interface RepairServicesSectionProps {
  onPriceChange: (index: number, price: number) => void;
  onRemove: (index: number) => void;
  onSelect: (repair: RepairCatalog) => void;
  repairs: SelectedRepair[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export default function RepairServicesSection({
  onPriceChange,
  onRemove,
  onSelect,
  repairs,
  t,
}: RepairServicesSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-bold font-headline text-on-surface text-sm">
          <span className="material-symbols-outlined text-primary text-sm">
            build
          </span>
          {t("intake.repair_services")}
        </span>
        {repairs.length > 0 && (
          <span className="rounded-full bg-primary-fixed px-2 py-0.5 font-bold font-label text-on-primary-fixed text-xs">
            {t("intake.repair_services_count", { count: repairs.length })}
          </span>
        )}
      </div>

      <RepairServicePicker
        compact
        onSelect={onSelect}
        selectedIds={repairs.map((r) => r.repairId)}
      />

      {repairs.length > 0 && (
        <div className="space-y-1.5">
          {repairs.map((repair, idx) => (
            <div
              className="flex items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2"
              key={repair.repairId}
            >
              <div className="min-w-0 flex-1">
                <p className="font-body font-medium text-on-surface text-sm">
                  {repair.repairName}
                </p>
                <p className="font-label text-on-surface-variant text-xs">
                  {t(`repair_category.${repair.category}`)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <input
                  aria-label={t("repair_price", { name: repair.repairName })}
                  className="min-h-[44px] w-28 rounded-lg bg-surface-container-lowest px-2 py-1 text-end font-body text-on-surface text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  min="0"
                  onChange={(e) => onPriceChange(idx, Number(e.target.value))}
                  step="0.01"
                  type="number"
                  value={repair.price}
                />
                <span className="font-label text-on-surface-variant text-xs">
                  {t("currency_eur")}
                </span>
              </div>
              <button
                className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
                onClick={() => onRemove(idx)}
                title={t("intake.remove_repair")}
                type="button"
              >
                <span className="material-symbols-outlined text-xs">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
