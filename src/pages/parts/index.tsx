import type { PartCategoryType } from "@shared/constants";
import { PartCategory } from "@shared/constants";
import type { PartsCatalog } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import AddPartModal, {
  type AddPartSubmitData,
} from "@/components/modules/parts/add-part-modal";
import RecordPurchaseDialog from "@/components/modules/parts/record-purchase-dialog";
import RestockForecastDialog from "@/components/modules/parts/restock-forecast-dialog";
import StockMovementsDialog from "@/components/modules/parts/stock-movements-dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { LowStockBadge } from "@/components/ui/low-stock-badge";
import { useCan } from "@/hooks/use-can";
import { useDebounce } from "@/hooks/use-debounce";
import { useFormatCurrency } from "@/hooks/use-format-currency";
import { PART_CATEGORY_TONES } from "@/lib/category-display";
import { usePartsCatalogStore } from "@/stores/parts-catalog";

type SortField = "name" | "category" | "defaultPrice" | "supplier";

const CATEGORIES: (PartCategoryType | "ALL")[] = [
  "ALL",
  ...Object.values(PartCategory),
];

function getAriaSort(
  currentSortBy: SortField,
  currentSortDir: "asc" | "desc",
  field: SortField
): "ascending" | "descending" | "none" {
  if (currentSortBy !== field) {
    return "none";
  }
  return currentSortDir === "asc" ? "ascending" : "descending";
}

function ConfirmToggle({
  isActive,
  onCancel,
  onConfirm,
  t,
}: {
  isActive: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col gap-2 p-2" role="alert">
      <p className="font-bold text-on-surface text-sm">
        {isActive ? t("confirm_deactivate") : t("confirm_activate")}
      </p>
      <p className="text-on-surface-variant text-xs">
        {isActive ? t("confirm_deactivate_desc") : t("confirm_activate_desc")}
      </p>
      <div className="flex gap-2">
        <button
          className="min-h-[44px] flex-1 rounded-lg bg-surface-container-high px-3 py-2 font-bold text-on-surface-variant text-xs transition-colors hover:bg-surface-container-highest"
          onClick={onCancel}
          type="button"
        >
          {t("add_part_modal.cancel")}
        </button>
        <button
          className={`min-h-[44px] flex-1 rounded-lg px-3 py-2 font-bold text-xs transition-colors ${
            isActive
              ? "bg-error-container text-on-error-container hover:opacity-90"
              : "bg-primary text-on-primary hover:opacity-90"
          }`}
          onClick={onConfirm}
          type="button"
        >
          {isActive ? t("deactivate_part") : t("activate_part")}
        </button>
      </div>
    </div>
  );
}

function SkeletonRow({ showCost }: { showCost: boolean }) {
  return (
    <tr>
      <td className="px-5 py-4">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-3/5 animate-pulse rounded bg-surface-container-high" />
          <div className="h-2 w-2/5 animate-pulse rounded bg-surface-container-highest" />
        </div>
      </td>
      <td className="px-5 py-4">
        <div className="h-5 w-16 animate-pulse rounded-full bg-surface-container-high" />
      </td>
      <td className="px-5 py-4">
        <div className="h-3 w-2/5 animate-pulse rounded bg-surface-container-high" />
      </td>
      <td className="px-5 py-4">
        <div className="h-3 w-8 animate-pulse rounded bg-surface-container-high" />
      </td>
      {showCost && (
        <td className="px-5 py-4">
          <div className="h-3 w-1/4 animate-pulse rounded bg-surface-container-high" />
        </td>
      )}
      <td className="px-5 py-4">
        <div className="h-5 w-16 animate-pulse rounded-full bg-surface-container-high" />
      </td>
      <td className="px-5 py-4">
        <div className="h-11 w-11 animate-pulse rounded-xl bg-surface-container-high" />
      </td>
    </tr>
  );
}

function DesktopPartRow({
  confirmingId,
  deletingId,
  isActive,
  nameCls,
  onDelete,
  onToggle,
  onCancelConfirm,
  onCancelDelete,
  onShowConfirm,
  onShowDelete,
  onShowMovements,
  onShowPurchase,
  onEdit,
  part,
  showCost,
  statusBadgeCls,
  t,
  togglingId,
  toggleBtnCls,
}: {
  confirmingId: string | null;
  deletingId: string | null;
  isActive: boolean;
  nameCls: string;
  onDelete: (part: PartsCatalog) => void;
  onToggle: (part: PartsCatalog) => void;
  onCancelConfirm: () => void;
  onCancelDelete: () => void;
  onShowConfirm: (id: string) => void;
  onShowDelete: (id: string) => void;
  onShowMovements: (part: PartsCatalog) => void;
  onShowPurchase: (part: PartsCatalog) => void;
  onEdit: (part: PartsCatalog) => void;
  part: PartsCatalog;
  showCost: boolean;
  statusBadgeCls: string;
  t: (key: string) => string;
  togglingId: string | null;
  toggleBtnCls: string;
}) {
  const isConfirming = confirmingId === part.id;
  const fmt = useFormatCurrency();

  const rowCls = isActive
    ? "transition-colors hover:bg-surface-container-lowest"
    : "bg-surface-container/30 transition-colors hover:bg-surface-container-lowest";

  return (
    <tr className={rowCls}>
      <td className="px-5 py-4">
        <div className="flex flex-col">
          <span className={nameCls}>{part.name}</span>
          <span className="font-mono text-on-surface-variant text-xs">
            {part.id.slice(0, 8)}
          </span>
        </div>
      </td>
      <td className="px-5 py-4">
        <span
          className={`rounded-full px-2.5 py-1 font-bold text-xs uppercase ${PART_CATEGORY_TONES[part.category]}`}
        >
          {t(`part_category.${part.category}`)}
        </span>
      </td>
      <td className="px-5 py-4">
        <span className="text-on-surface-variant text-sm">
          {part.supplier ?? "\u2014"}
        </span>
      </td>
      <td className="px-5 py-4">
        <span
          className={`font-mono font-semibold text-sm ${
            (part.stockQuantity ?? 0) <= 0 ? "text-error" : "text-on-surface"
          }`}
          data-testid="part-stock"
        >
          {part.stockQuantity ?? 0}
        </span>
      </td>
      {showCost && (
        <td className="px-5 py-4">
          <span className="font-mono font-semibold text-sm">
            {fmt(Number(part.defaultPrice))}
          </span>
        </td>
      )}
      <td className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 font-bold text-xs ${statusBadgeCls}`}
          >
            {isActive ? t("active") : t("inactive")}
          </span>
          <LowStockBadge
            reorderLevel={part.reorderLevel}
            stockQuantity={part.stockQuantity}
          />
        </div>
      </td>
      <td className="px-5 py-4">
        {isConfirming && (
          <ConfirmToggle
            isActive={isActive}
            onCancel={onCancelConfirm}
            onConfirm={() => onToggle(part)}
            t={t}
          />
        )}
        {!isConfirming && deletingId === part.id && (
          <div className="flex flex-col gap-2 p-2" role="alert">
            <p className="font-bold text-on-surface text-sm">
              {t("delete_part_confirm_title")}
            </p>
            <p className="text-on-surface-variant text-xs">
              {t("delete_part_confirm_desc")}
            </p>
            <div className="flex gap-2">
              <button
                className="min-h-[44px] flex-1 rounded-lg bg-surface-container-high px-3 py-2 font-bold text-on-surface-variant text-xs transition-colors hover:bg-surface-container-highest"
                onClick={onCancelDelete}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="min-h-[44px] flex-1 rounded-lg bg-error-container px-3 py-2 font-bold text-on-error-container text-xs transition-colors hover:opacity-90"
                onClick={() => onDelete(part)}
                type="button"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        )}
        {!isConfirming && deletingId !== part.id && (
          <div className="flex items-center gap-1">
            <button
              aria-label={t("parts_movements_title")}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
              onClick={() => onShowMovements(part)}
              type="button"
            >
              <Icon name="history" size="sm" />
            </button>
            <button
              aria-label={t("parts_record_purchase")}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
              onClick={() => onShowPurchase(part)}
              type="button"
            >
              <Icon name="shopping_cart" size="sm" />
            </button>
            <button
              aria-label={t("edit_part")}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
              onClick={() => onEdit(part)}
              type="button"
            >
              <Icon name="edit" size="sm" />
            </button>
            <button
              aria-label={isActive ? t("deactivate_part") : t("activate_part")}
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${toggleBtnCls}`}
              disabled={togglingId === part.id}
              onClick={() => onShowConfirm(part.id)}
              type="button"
            >
              <Icon name={isActive ? "toggle_on" : "toggle_off"} size="sm" />
            </button>
            <button
              aria-label={t("delete_part")}
              className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
              onClick={() => onShowDelete(part.id)}
              type="button"
            >
              <Icon name="delete" size="sm" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function MobilePartCard({
  confirmingId,
  deletingId,
  onToggle,
  onDelete,
  onCancelConfirm,
  onCancelDelete,
  onShowConfirm,
  onShowDelete,
  onShowMovements,
  onShowPurchase,
  onEdit,
  part,
  showCost,
  t,
  togglingId,
}: {
  confirmingId: string | null;
  deletingId: string | null;
  onToggle: (part: PartsCatalog) => void;
  onDelete: (part: PartsCatalog) => void;
  onCancelConfirm: () => void;
  onCancelDelete: () => void;
  onShowConfirm: (id: string) => void;
  onShowDelete: (id: string) => void;
  onShowMovements: (part: PartsCatalog) => void;
  onShowPurchase: (part: PartsCatalog) => void;
  onEdit: (part: PartsCatalog) => void;
  part: PartsCatalog;
  showCost: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  togglingId: string | null;
}) {
  const isActive = part.isActive;
  const isConfirming = confirmingId === part.id;
  const fmt = useFormatCurrency();

  const cardCls = isActive ? "p-4" : "bg-surface-container/30 p-4";
  const nameCls = isActive
    ? "font-bold text-on-surface text-sm"
    : "font-bold text-on-surface-variant text-sm";
  const statusBadgeCls = isActive
    ? "bg-primary-container text-on-primary-container"
    : "bg-surface-container-high text-on-surface-variant";

  return (
    <div className={cardCls}>
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0">
          <h3 className={nameCls}>{part.name}</h3>
          <span className="font-mono text-on-surface-variant text-xs">
            {part.id.slice(0, 8)}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 font-bold text-xs uppercase ${PART_CATEGORY_TONES[part.category]}`}
        >
          {t(`part_category.${part.category}`)}
        </span>
      </div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`rounded-full px-2.5 py-1 font-bold text-xs ${statusBadgeCls}`}
          >
            {isActive ? t("active") : t("inactive")}
          </span>
          <LowStockBadge
            reorderLevel={part.reorderLevel}
            stockQuantity={part.stockQuantity}
          />
          <span className="font-mono text-on-surface-variant text-xs">
            {t("parts_stock_count", { count: part.stockQuantity ?? 0 })}
          </span>
        </div>
        {showCost && (
          <span className="font-bold font-mono text-primary text-sm">
            {fmt(Number(part.defaultPrice))}
          </span>
        )}
      </div>
      <div className="-mx-1 flex items-center gap-2 rounded-xl bg-surface-container-lowest px-1 py-1">
        {part.supplier && (
          <span className="flex-1 px-3 py-2 text-on-surface-variant text-xs">
            {part.supplier}
          </span>
        )}
        {deletingId === part.id && (
          <div className="flex flex-1 flex-col gap-2 p-2" role="alert">
            <p className="font-bold text-on-surface text-sm">
              {t("delete_part_confirm_title")}
            </p>
            <p className="text-on-surface-variant text-xs">
              {t("delete_part_confirm_desc")}
            </p>
            <div className="flex gap-2">
              <button
                className="min-h-[44px] flex-1 rounded-lg bg-surface-container-high px-3 py-2 font-bold text-on-surface-variant text-xs transition-colors hover:bg-surface-container-highest"
                onClick={onCancelDelete}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="min-h-[44px] flex-1 rounded-lg bg-error-container px-3 py-2 font-bold text-on-error-container text-xs transition-colors hover:opacity-90"
                onClick={() => onDelete(part)}
                type="button"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        )}
        {deletingId !== part.id && isConfirming && (
          <ConfirmToggle
            isActive={isActive}
            onCancel={onCancelConfirm}
            onConfirm={() => onToggle(part)}
            t={t}
          />
        )}
        {deletingId !== part.id && !isConfirming && (
          <>
            <button
              aria-label={t("parts_movements_title")}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-on-surface-variant text-xs transition-all hover:bg-surface-container-high hover:text-primary"
              onClick={() => onShowMovements(part)}
              type="button"
            >
              <Icon name="history" size="sm" />
            </button>
            <button
              aria-label={t("parts_record_purchase")}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-on-surface-variant text-xs transition-all hover:bg-surface-container-high hover:text-primary"
              onClick={() => onShowPurchase(part)}
              type="button"
            >
              <Icon name="shopping_cart" size="sm" />
            </button>
            <button
              aria-label={t("edit_part")}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-on-surface-variant text-xs transition-all hover:bg-surface-container-high hover:text-primary"
              onClick={() => onEdit(part)}
              type="button"
            >
              <Icon name="edit" size="sm" />
              <span>{t("edit")}</span>
            </button>
            <button
              aria-label={isActive ? t("deactivate_part") : t("activate_part")}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-xs transition-all ${
                isActive
                  ? "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
                  : "text-primary hover:bg-primary-container"
              }`}
              disabled={togglingId === part.id}
              onClick={() => onShowConfirm(part.id)}
              type="button"
            >
              <Icon name={isActive ? "toggle_on" : "toggle_off"} size="sm" />
              <span>
                {isActive ? t("deactivate_part") : t("activate_part")}
              </span>
            </button>
            <button
              aria-label={t("delete_part")}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl font-bold text-on-surface-variant text-xs transition-all hover:bg-error-container hover:text-on-error-container"
              onClick={() => onShowDelete(part.id)}
              type="button"
            >
              <Icon name="delete" size="sm" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RestockFilterPill({
  active,
  onToggle,
  t,
}: {
  active: boolean;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2.5 font-bold text-xs uppercase tracking-wide transition-all ${
        active
          ? "bg-error text-on-error"
          : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
      }`}
      onClick={onToggle}
      type="button"
    >
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[16px]"
      >
        warning
      </span>
      {t("parts_needs_restock_filter")}
    </button>
  );
}

function PartsExtraDialogs({
  movementsPart,
  purchasePart,
  setMovementsPart,
  setPurchasePart,
  setShowForecast,
  showForecast,
}: {
  movementsPart: PartsCatalog | null;
  purchasePart: PartsCatalog | null;
  setMovementsPart: (part: PartsCatalog | null) => void;
  setPurchasePart: (part: PartsCatalog | null) => void;
  setShowForecast: (show: boolean) => void;
  showForecast: boolean;
}) {
  return (
    <>
      {movementsPart && (
        <StockMovementsDialog
          onClose={() => setMovementsPart(null)}
          partId={movementsPart.id}
          partName={movementsPart.name}
        />
      )}
      {purchasePart && (
        <RecordPurchaseDialog
          onClose={() => setPurchasePart(null)}
          part={purchasePart}
        />
      )}
      {showForecast && (
        <RestockForecastDialogWrapper
          onClose={() => setShowForecast(false)}
          setPurchasePart={setPurchasePart}
        />
      )}
    </>
  );
}

function RestockForecastDialogWrapper({
  onClose,
  setPurchasePart,
}: {
  onClose: () => void;
  setPurchasePart: (part: PartsCatalog | null) => void;
}) {
  const { fetchPartById } = usePartsCatalogStore();

  const handleBuySuggestion = useCallback(
    async (partId: string) => {
      const part = await fetchPartById(partId);
      if (part) {
        onClose();
        setPurchasePart(part);
      }
    },
    [fetchPartById, onClose, setPurchasePart]
  );

  return (
    <RestockForecastDialog
      onBuySuggestion={handleBuySuggestion}
      onClose={onClose}
    />
  );
}

function CategoryFilterPills({
  activeFilter,
  onFilterChange,
  showAllCategories,
  onToggleAll,
  t,
}: {
  activeFilter: PartCategoryType | "ALL";
  onFilterChange: (cat: PartCategoryType | "ALL") => void;
  onToggleAll: (show: boolean) => void;
  showAllCategories: boolean;
  t: (key: string) => string;
}) {
  const visibleCats = CATEGORIES.filter(
    (cat) => showAllCategories || cat === "ALL" || CATEGORIES.indexOf(cat) <= 4
  );

  return (
    <fieldset
      aria-label={t("filters")}
      className="hide-scrollbar flex flex-wrap items-center gap-2"
    >
      <legend className="sr-only">{t("filter_by_category")}</legend>
      {visibleCats.map((cat) => {
        const isActive = activeFilter === cat;
        return (
          <button
            aria-pressed={isActive}
            className={`min-h-[44px] shrink-0 rounded-full px-4 py-2.5 font-bold text-xs uppercase tracking-wide transition-all ${
              isActive
                ? "bg-primary text-on-primary"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
            }`}
            key={cat}
            onClick={() => onFilterChange(cat)}
            type="button"
          >
            {cat === "ALL" ? t("all_categories") : t(`part_category.${cat}`)}
          </button>
        );
      })}
      {!showAllCategories && CATEGORIES.length > 5 && (
        <button
          className="min-h-[44px] shrink-0 rounded-full px-4 py-2.5 font-bold text-primary text-xs uppercase tracking-wide transition-all hover:bg-surface-container-high"
          onClick={() => onToggleAll(true)}
          type="button"
        >
          {t("show_more")}
        </button>
      )}
      {showAllCategories && (
        <button
          className="min-h-[44px] shrink-0 rounded-full px-4 py-2.5 font-bold text-on-surface-variant text-xs uppercase tracking-wide transition-all hover:bg-surface-container-high"
          onClick={() => onToggleAll(false)}
          type="button"
        >
          {t("show_less")}
        </button>
      )}
    </fieldset>
  );
}

function PartsDesktopTable({
  confirmingId,
  deletingId,
  isLoading,
  onCancelConfirm,
  onCancelDelete,
  onShowConfirm,
  onShowDelete,
  onShowMovements,
  onShowPurchase,
  onDelete,
  onSort,
  onToggle,
  onEdit,
  parts,
  showCost,
  sortBy,
  sortDir,
  t,
  togglingId,
}: {
  confirmingId: string | null;
  deletingId: string | null;
  isLoading: boolean;
  onCancelConfirm: () => void;
  onCancelDelete: () => void;
  onShowConfirm: (id: string) => void;
  onShowDelete: (id: string) => void;
  onShowMovements: (part: PartsCatalog) => void;
  onShowPurchase: (part: PartsCatalog) => void;
  onDelete: (part: PartsCatalog) => void;
  onSort: (field: SortField) => void;
  onToggle: (part: PartsCatalog) => void;
  onEdit: (part: PartsCatalog) => void;
  parts: PartsCatalog[];
  showCost: boolean;
  sortBy: SortField;
  sortDir: "asc" | "desc";
  t: (key: string) => string;
  togglingId: string | null;
}) {
  const sortableCls =
    "cursor-pointer px-5 py-4 font-bold text-on-surface-variant text-xs uppercase tracking-wide transition-colors hover:text-primary";

  return (
    <table className="w-full border-collapse text-start">
      <thead>
        <tr className="bg-surface-container-high/50">
          <th
            aria-sort={getAriaSort(sortBy, sortDir, "name")}
            className={sortableCls}
            onClick={() => onSort("name")}
          >
            {t("part_details")}
            {sortBy === "name" && (
              <Icon
                className="ms-1 align-middle text-primary"
                name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
                size="xs"
              />
            )}
          </th>
          <th
            aria-sort={getAriaSort(sortBy, sortDir, "category")}
            className={sortableCls}
            onClick={() => onSort("category")}
          >
            {t("category")}
            {sortBy === "category" && (
              <Icon
                className="ms-1 align-middle text-primary"
                name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
                size="xs"
              />
            )}
          </th>
          <th
            aria-sort={getAriaSort(sortBy, sortDir, "supplier")}
            className={sortableCls}
            onClick={() => onSort("supplier")}
          >
            {t("supplier")}
            {sortBy === "supplier" && (
              <Icon
                className="ms-1 align-middle text-primary"
                name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
                size="xs"
              />
            )}
          </th>
          <th className="px-5 py-4 font-bold text-on-surface-variant text-xs uppercase tracking-wide">
            {t("parts_stock")}
          </th>
          {showCost && (
            <th
              aria-sort={getAriaSort(sortBy, sortDir, "defaultPrice")}
              className={sortableCls}
              onClick={() => onSort("defaultPrice")}
            >
              {t("unit_cost")}
              {sortBy === "defaultPrice" && (
                <Icon
                  className="ms-1 align-middle text-primary"
                  name={sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
                  size="xs"
                />
              )}
            </th>
          )}
          <th className="px-5 py-4 font-bold text-on-surface-variant text-xs uppercase tracking-wide">
            {t("status_label")}
          </th>
          <th className="px-5 py-4 font-bold text-on-surface-variant text-xs uppercase tracking-wide">
            {t("manage")}
          </th>
        </tr>
      </thead>
      <tbody>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={`skeleton-${String(i)}`} showCost={showCost} />
            ))
          : parts.map((part) => {
              const isActive = part.isActive;
              return (
                <DesktopPartRow
                  confirmingId={confirmingId}
                  deletingId={deletingId}
                  isActive={isActive}
                  key={part.id}
                  nameCls={
                    isActive
                      ? "font-bold text-on-surface text-sm"
                      : "font-bold text-on-surface-variant text-sm"
                  }
                  onCancelConfirm={onCancelConfirm}
                  onCancelDelete={onCancelDelete}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onShowConfirm={onShowConfirm}
                  onShowDelete={onShowDelete}
                  onShowMovements={onShowMovements}
                  onShowPurchase={onShowPurchase}
                  onToggle={onToggle}
                  part={part}
                  showCost={showCost}
                  statusBadgeCls={
                    isActive
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container-high text-on-surface-variant"
                  }
                  t={t}
                  toggleBtnCls={
                    isActive
                      ? "text-on-surface-variant hover:bg-surface-container-high hover:text-primary"
                      : "text-primary hover:bg-primary-container"
                  }
                  togglingId={togglingId}
                />
              );
            })}
      </tbody>
    </table>
  );
}

function EmptyCatalogState({
  onAdd,
  t,
}: {
  onAdd: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-container">
        <Icon className="text-on-primary-container" name="category" size="xl" />
      </div>
      <h3 className="font-bold font-headline text-lg text-on-surface">
        {t("empty_catalog_title")}
      </h3>
      <p className="mt-1 mb-6 max-w-xs text-on-surface-variant text-sm">
        {t("empty_catalog_desc")}
      </p>
      <button
        className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-on-primary text-sm shadow-md shadow-primary/10 transition-all hover:bg-primary/90 active:scale-[0.98]"
        onClick={onAdd}
        type="button"
      >
        <Icon name="add" size="sm" />
        <span>{t("add_new_part")}</span>
      </button>
    </div>
  );
}

function ToastNotification({
  isError,
  message,
}: {
  isError: boolean;
  message: string;
}) {
  return (
    <div
      aria-live="polite"
      className={`fixed end-6 bottom-6 z-50 flex animate-[fadeSlideUp_0.3s_ease-out] items-center gap-2 rounded-2xl px-5 py-3 font-bold text-sm shadow-2xl ${
        isError ? "bg-error text-on-error" : "bg-primary text-on-primary"
      }`}
      role="status"
    >
      <Icon name={isError ? "error" : "check_circle"} size="sm" />
      {message}
    </div>
  );
}

export default function PartsCatalogPage() {
  const { t } = useTranslation();
  const fmt = useFormatCurrency();
  const canViewCost = useCan({ parts: ["viewCost"] });
  const {
    parts,
    isLoading,
    error,
    totalCount,
    fetchParts,
    createPart,
    loadMoreParts,
    nextCursor,
    isLoadingMore,
    togglePartActive,
    deletePart,
    updatePart,
    clearError,
  } = usePartsCatalogStore();

  const [searchParams, setSearchParams] = useSearchParams();
  // The query string, not local state, holds the term: a deep link from the
  // command palette has to land pre-filtered even when this page is already
  // mounted, and the filtered view stays shareable and survives Back.
  const search = searchParams.get("search") ?? "";
  const setSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set("search", value);
          } else {
            next.delete("search");
          }
          return next;
        },
        // Typing should not stack a history entry per keystroke.
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activeFilter, setActiveFilter] = useState<PartCategoryType | "ALL">(
    "ALL"
  );
  const [needsRestockFilter, setNeedsRestockFilter] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPart, setEditingPart] = useState<PartsCatalog | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [confirmingPartId, setConfirmingPartId] = useState<string | null>(null);
  const [deletingPartId, setDeletingPartId] = useState<string | null>(null);
  const [movementsPart, setMovementsPart] = useState<PartsCatalog | null>(null);
  const [purchasePart, setPurchasePart] = useState<PartsCatalog | null>(null);
  const [showForecast, setShowForecast] = useState(false);
  const [toast, setToast] = useState<{
    isError: boolean;
    message: string;
  } | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ isError, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      category: activeFilter === "ALL" ? undefined : activeFilter,
      needsRestock: needsRestockFilter || undefined,
    }),
    [debouncedSearch, activeFilter, needsRestockFilter]
  );

  useEffect(() => {
    fetchParts(fetchParams);
  }, [fetchParams, fetchParts]);

  useEffect(() => {
    if (error) {
      showToast(error, true);
      clearError();
    }
  }, [error, showToast, clearError]);

  const sorted = useMemo(
    () =>
      [...parts].sort((a, b) => {
        const mul = sortDir === "asc" ? 1 : -1;
        const av = a[sortBy];
        const bv = b[sortBy];
        if (typeof av === "string" && typeof bv === "string") {
          return mul * av.localeCompare(bv);
        }
        return mul * (Number(av) - Number(bv));
      }),
    [parts, sortBy, sortDir]
  );

  const toggleSort = useCallback((field: SortField) => {
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const { activeCount, catalogValue, uniqueSuppliers } = useMemo(() => {
    const active = parts.filter((p) => p.isActive);
    return {
      activeCount: active.length,
      // Value of what is on the shelf: unit cost × quantity in stock.
      catalogValue: active.reduce(
        (acc, p) =>
          acc + Number(p.defaultPrice) * Math.max(0, p.stockQuantity ?? 0),
        0
      ),
      uniqueSuppliers: new Set(
        active
          .filter(
            (p): p is PartsCatalog & { supplier: string } => p.supplier !== null
          )
          .map((p) => p.supplier)
      ).size,
    };
  }, [parts]);

  const handleAddPart = async (data: AddPartSubmitData) => {
    if (!data.category) {
      showToast(t("failed_to_create_part"), true);
      return;
    }
    try {
      await createPart({
        category: data.category,
        defaultPrice: data.defaultPrice,
        name: data.name,
        supplier: data.supplier || undefined,
        listedOnline: data.listedOnline,
        reorderLevel: data.reorderLevel,
        stockQuantity: data.stockQuantity,
      });
      setShowAddModal(false);
      showToast(t("part_added_successfully"));
      await fetchParts(fetchParams);
    } catch {
      showToast(t("failed_to_create_part"), true);
    }
  };

  const handleToggleActive = async (part: PartsCatalog) => {
    setConfirmingPartId(null);
    setTogglingId(part.id);
    try {
      await togglePartActive(part.id, !part.isActive);
      showToast(t("part_status_changed"));
    } catch {
      showToast(t("failed_to_update_status"), true);
    } finally {
      setTogglingId(null);
    }
  };

  const handleEditPart = (part: PartsCatalog) => {
    setEditingPart(part);
  };

  const handleEditSubmit = async (data: AddPartSubmitData) => {
    if (!editingPart) {
      return;
    }
    if (!data.category) {
      showToast(t("failed_to_create_part"), true);
      return;
    }
    try {
      await updatePart(editingPart.id, {
        name: data.name,
        category: data.category,
        defaultPrice: data.defaultPrice,
        supplier: data.supplier || undefined,
        isActive: data.isActive,
        listedOnline: data.listedOnline,
        reorderLevel: data.reorderLevel,
      });
      setEditingPart(null);
      showToast(t("part_updated_successfully"));
    } catch {
      showToast(t("errors.update_part"), true);
    }
  };

  const handleDeletePart = async (part: PartsCatalog) => {
    setDeletingPartId(null);
    try {
      await deletePart(part.id);
      showToast(t("part_deleted_successfully"));
    } catch {
      showToast(t("failed_to_delete_part"), true);
    }
  };

  const hasParts = sorted.length > 0 || isLoading;
  const showSearchEmpty =
    sorted.length === 0 &&
    !isLoading &&
    (search !== "" || activeFilter !== "ALL" || needsRestockFilter);
  const showEmptyCatalog =
    totalCount === 0 && !isLoading && search === "" && activeFilter === "ALL";
  const hasMore = nextCursor !== null && !isLoading;

  const handleLoadMore = useCallback(() => {
    loadMoreParts({
      search: debouncedSearch || undefined,
      category: activeFilter === "ALL" ? undefined : activeFilter,
      needsRestock: needsRestockFilter || undefined,
    });
  }, [loadMoreParts, debouncedSearch, activeFilter, needsRestockFilter]);

  const metricGridCols = canViewCost
    ? "grid-cols-2 sm:grid-cols-4"
    : "grid-cols-2 sm:grid-cols-3";

  return (
    <>
      <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("parts_inventory")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("parts_inventory_desc")}
          </p>
        </div>
        <button
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-bold text-on-primary text-sm shadow-md shadow-primary/10 transition-all hover:bg-primary/90 active:scale-[0.98] sm:flex-none md:px-8"
          onClick={() => setShowAddModal(true)}
          type="button"
        >
          <Icon name="add" size="sm" />
          <span className="whitespace-nowrap">{t("add_new_part")}</span>
        </button>
      </div>

      {!showEmptyCatalog && (
        <section aria-label={t("inventory_value")}>
          <h3 className="sr-only">{t("inventory_value")}</h3>
          <div className={`mb-6 grid gap-4 ${metricGridCols}`}>
            <div className="rounded-2xl bg-surface-container-low p-5 md:col-span-2">
              <p className="font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("total_parts")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-4xl text-on-surface">
                {totalCount}
              </p>
            </div>
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("active")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-2xl text-on-surface">
                {activeCount}
              </p>
            </div>
            {canViewCost && (
              <div className="rounded-xl bg-surface-container-low p-4">
                <p className="font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                  {t("inventory_value")}
                </p>
                <p className="mt-1 font-extrabold font-headline text-2xl text-on-surface">
                  {fmt(catalogValue)}
                </p>
              </div>
            )}
            <div className="rounded-xl bg-surface-container-low p-4">
              <p className="font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("active_suppliers")}
              </p>
              <p className="mt-1 font-extrabold font-headline text-2xl text-on-surface">
                {uniqueSuppliers}
              </p>
            </div>
          </div>
        </section>
      )}

      {!showEmptyCatalog && (
        <div className="mb-5">
          <Input
            iconStart="search"
            id="parts-search"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("search_parts_placeholder")}
            value={search}
          />
          <div className="mt-3">
            <CategoryFilterPills
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              onToggleAll={setShowAllCategories}
              showAllCategories={showAllCategories}
              t={t}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RestockFilterPill
              active={needsRestockFilter}
              onToggle={() => setNeedsRestockFilter((v) => !v)}
              t={t}
            />
            <button
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-surface-container-high px-4 py-2.5 font-bold text-on-surface-variant text-xs uppercase tracking-wide transition-colors hover:bg-surface-container-highest"
              onClick={() => setShowForecast(true)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[16px]"
              >
                trending_down
              </span>
              {t("parts_restock_forecast")}
            </button>
          </div>
          {activeFilter !== "ALL" && (
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full bg-primary px-3 py-1 font-bold text-on-primary text-xs uppercase">
                {t(`part_category.${activeFilter}`)}
              </span>
              <button
                className="flex min-h-[44px] items-center gap-1 rounded-full px-2 py-1 text-on-surface-variant text-xs transition-all hover:text-on-surface"
                onClick={() => setActiveFilter("ALL")}
                type="button"
              >
                <Icon name="close" size="xs" />
              </button>
            </div>
          )}
        </div>
      )}

      {showEmptyCatalog && (
        <EmptyCatalogState onAdd={() => setShowAddModal(true)} t={t} />
      )}

      {showSearchEmpty && (
        <div
          className="flex flex-col items-center justify-center py-16"
          role="status"
        >
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-container-low">
            <Icon
              className="text-on-surface-variant"
              name="search_off"
              size="xl"
            />
          </div>
          <p className="font-bold font-headline text-lg text-on-surface">
            {t("no_parts_found")}
          </p>
          <p className="mt-1 text-on-surface-variant text-sm">
            {t("try_different_search")}
          </p>
          <button
            className="mt-5 min-h-11 rounded-xl bg-surface-container-high px-5 font-bold text-on-surface-variant text-sm transition-colors hover:bg-surface-container-highest"
            onClick={() => {
              setSearch("");
              setActiveFilter("ALL");
              setNeedsRestockFilter(false);
            }}
            type="button"
          >
            {t("clear_filters")}
          </button>
        </div>
      )}

      {hasParts && (
        <div className="overflow-hidden rounded-2xl bg-surface-container-low">
          <div className="hidden overflow-x-auto md:block">
            <PartsDesktopTable
              confirmingId={confirmingPartId}
              deletingId={deletingPartId}
              isLoading={isLoading}
              onCancelConfirm={() => setConfirmingPartId(null)}
              onCancelDelete={() => setDeletingPartId(null)}
              onDelete={handleDeletePart}
              onEdit={handleEditPart}
              onShowConfirm={setConfirmingPartId}
              onShowDelete={setDeletingPartId}
              onShowMovements={setMovementsPart}
              onShowPurchase={setPurchasePart}
              onSort={toggleSort}
              onToggle={handleToggleActive}
              parts={sorted}
              showCost={canViewCost}
              sortBy={sortBy}
              sortDir={sortDir}
              t={t}
              togglingId={togglingId}
            />
          </div>

          <div className="md:hidden">
            {isLoading ? (
              <div className="p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    className="flex flex-col gap-3 py-4"
                    key={`mobile-skeleton-${String(i)}`}
                  >
                    <div className="h-3 w-3/5 animate-pulse rounded bg-surface-container-high" />
                    <div className="h-2 w-2/5 animate-pulse rounded bg-surface-container-highest" />
                    <div className="h-1.5 w-full animate-pulse rounded-full bg-surface-container-highest" />
                  </div>
                ))}
              </div>
            ) : (
              sorted.map((part) => (
                <MobilePartCard
                  confirmingId={confirmingPartId}
                  deletingId={deletingPartId}
                  key={part.id}
                  onCancelConfirm={() => setConfirmingPartId(null)}
                  onCancelDelete={() => setDeletingPartId(null)}
                  onDelete={handleDeletePart}
                  onEdit={handleEditPart}
                  onShowConfirm={setConfirmingPartId}
                  onShowDelete={setDeletingPartId}
                  onShowMovements={setMovementsPart}
                  onShowPurchase={setPurchasePart}
                  onToggle={handleToggleActive}
                  part={part}
                  showCost={canViewCost}
                  t={t}
                  togglingId={togglingId}
                />
              ))
            )}
          </div>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center py-4">
          <button
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-surface-container-high px-6 py-3 font-bold text-on-surface-variant text-sm transition-all hover:bg-surface-container-highest active:scale-[0.98]"
            disabled={isLoadingMore}
            onClick={handleLoadMore}
            type="button"
          >
            {isLoadingMore && (
              <Icon
                className="animate-spin"
                name="progress_activity"
                size="sm"
              />
            )}
            <span>{t("load_more")}</span>
          </button>
        </div>
      )}

      {showAddModal && (
        <AddPartModal
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddPart}
        />
      )}

      {editingPart && (
        <AddPartModal
          editingPart={editingPart}
          onClose={() => setEditingPart(null)}
          onSubmit={handleEditSubmit}
        />
      )}

      <PartsExtraDialogs
        movementsPart={movementsPart}
        purchasePart={purchasePart}
        setMovementsPart={setMovementsPart}
        setPurchasePart={setPurchasePart}
        setShowForecast={setShowForecast}
        showForecast={showForecast}
      />

      {toast && (
        <ToastNotification isError={toast.isError} message={toast.message} />
      )}
    </>
  );
}
