import { isLowStock } from "@shared/utils/stock-level";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/icon";

interface LowStockBadgeProps {
  className?: string;
  reorderLevel: number;
  stockQuantity: number;
}

/**
 * Compact "restock" badge for parts at or below their reorder level.
 * Same threshold as the owner low-stock alert (shared/utils/stock-level).
 */
export function LowStockBadge({
  className = "",
  reorderLevel,
  stockQuantity,
}: LowStockBadgeProps) {
  const { t } = useTranslation();
  if (!isLowStock({ reorderLevel, stockQuantity })) {
    return null;
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-error-container px-2.5 py-1 font-bold text-on-error-container text-xs ${className}`}
    >
      <Icon className="text-[14px]" name="warning" />
      {t("parts_low_stock_badge")}
    </span>
  );
}
