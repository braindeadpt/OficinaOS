import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

interface PartsAlertItem {
  name: string;
  quantity: number;
  stockLevel: number;
  threshold: number;
}

interface PartsAlertProps {
  items: PartsAlertItem[];
}

function getStockStatus(item: PartsAlertItem) {
  if (item.quantity === 0) {
    return {
      color: "bg-error",
      labelKey: "tech_dashboard.out_of_stock",
      textColor: "text-error",
      width: "0%",
    };
  }
  if (item.stockLevel === 0) {
    return {
      color: "bg-error",
      labelKey: "tech_dashboard.left",
      textColor: "text-error",
      width: "0%",
    };
  }
  const pct = Math.min(
    100,
    Math.max(0, (item.quantity / item.stockLevel) * 100)
  );
  if (item.quantity <= item.threshold) {
    return {
      color: "bg-error",
      labelKey: "tech_dashboard.left",
      textColor: "text-error",
      width: `${pct}%`,
    };
  }
  if (item.quantity <= item.threshold * 2) {
    return {
      color: "bg-tertiary",
      labelKey: "tech_dashboard.left",
      textColor: "text-tertiary",
      width: `${pct}%`,
    };
  }
  return {
    color: "bg-primary",
    labelKey: "tech_dashboard.left",
    textColor: "text-primary",
    width: "100%",
  };
}

export default function PartsAlert({ items }: PartsAlertProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl bg-surface-container-low p-6">
      <div className="mb-6 flex items-center gap-2">
        <Icon className="text-error" name="warning" size="lg" />
        <h3 className="font-bold font-headline text-lg text-on-surface">
          {t("tech_dashboard.parts_alert")}
        </h3>
      </div>
      <div className="space-y-5">
        {items.map((item) => {
          const status = getStockStatus(item);
          return (
            <div key={item.name}>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold text-on-surface text-xs">
                  {item.name}
                </span>
                <span className={`font-black text-xs ${status.textColor}`}>
                  {item.quantity === 0
                    ? t(status.labelKey)
                    : `${item.quantity} ${t(status.labelKey)}`}
                </span>
              </div>
              <div
                aria-label={`${item.name} stock level`}
                aria-valuemax={item.stockLevel}
                aria-valuemin={0}
                aria-valuenow={item.quantity}
                className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest"
                role="progressbar"
              >
                <div
                  className={`h-full rounded-full ${status.color}`}
                  style={{ width: status.width }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <button
        className="mt-8 w-full rounded-xl bg-surface-container-highest py-3 font-bold text-on-surface-variant text-xs transition-colors hover:bg-surface-container-high"
        type="button"
      >
        {t("tech_dashboard.view_all_parts")}
      </button>
    </div>
  );
}
