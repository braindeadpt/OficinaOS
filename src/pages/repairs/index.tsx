import type { RepairCatalog } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RepairFormData } from "@/components/modules/repairs/add-repair-modal";
import AddRepairModal from "@/components/modules/repairs/add-repair-modal";
import CategoryHealth from "@/components/modules/repairs/category-health";
import DeleteRepairDialog from "@/components/modules/repairs/delete-repair-dialog";
import type { SortOption } from "@/components/modules/repairs/repair-filters";
import RepairFilters from "@/components/modules/repairs/repair-filters";
import RepairMobileCard from "@/components/modules/repairs/repair-mobile-card";
import type {
  RepairCategory,
  RepairItem,
} from "@/components/modules/repairs/repair-table";
import RepairTable from "@/components/modules/repairs/repair-table";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { useRepairCatalogStore } from "@/stores/repair-catalog";

const CATEGORY_ICONS: Record<
  string,
  { icon: string; iconBg: string; iconColor: string }
> = {
  HARDWARE: {
    icon: "build",
    iconBg: "bg-primary-fixed",
    iconColor: "text-primary",
  },
  SOFTWARE: {
    icon: "terminal",
    iconBg: "bg-secondary-fixed",
    iconColor: "text-secondary",
  },
  DIAGNOSTIC: {
    icon: "troubleshoot",
    iconBg: "bg-tertiary-fixed",
    iconColor: "text-tertiary",
  },
};

const CATEGORY_PREFIXES: Record<string, string> = {
  HARDWARE: "HW",
  SOFTWARE: "SW",
  DIAGNOSTIC: "DG",
};

function toRepairItem(r: RepairCatalog): RepairItem {
  const cat = r.category as string;
  const display = CATEGORY_ICONS[cat] ?? CATEGORY_ICONS.HARDWARE;
  const prefix = CATEGORY_PREFIXES[cat] ?? "HW";
  return {
    id: r.id,
    code: `REP-${prefix}-${r.id.slice(-3).toUpperCase()}`,
    name: r.name,
    category: cat as RepairCategory,
    basePrice:
      typeof r.defaultPrice === "number"
        ? r.defaultPrice
        : Number(r.defaultPrice),
    icon: display.icon,
    iconBg: display.iconBg,
    iconColor: display.iconColor,
    isActive: r.isActive,
  };
}

function RepairListEmpty({ onClearFilters }: { onClearFilters: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-container-low px-6 py-16 text-center">
      <span className="material-symbols-outlined mb-4 text-[48px] text-on-surface-variant">
        search_off
      </span>
      <p className="font-headline font-semibold text-lg text-on-surface">
        {t("no_repairs_found")}
      </p>
      <p className="mt-1 max-w-sm text-on-surface-variant text-sm">
        {t("no_repairs_found_desc")}
      </p>
      <button
        className="mt-6 min-h-11 rounded-xl bg-surface-container-high px-5 font-bold font-headline text-on-surface-variant text-sm transition-all hover:bg-surface-container-highest"
        onClick={onClearFilters}
        type="button"
      >
        {t("clear_filters")}
      </button>
    </div>
  );
}

function RepairListContent({
  onEdit,
  onShowDelete,
  onToggleActive,
  sorted,
  togglingId,
}: {
  onEdit: (item: RepairItem) => void;
  onShowDelete: (id: string) => void;
  onToggleActive: (item: RepairItem) => void;
  sorted: RepairItem[];
  togglingId: string | null;
}) {
  return (
    <>
      <div className="hidden md:block">
        <RepairTable
          onEdit={onEdit}
          onShowDelete={onShowDelete}
          onToggleActive={onToggleActive}
          repairs={sorted}
          togglingId={togglingId}
        />
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {sorted.map((repair) => (
          <RepairMobileCard
            key={repair.id}
            onEdit={onEdit}
            onShowDelete={onShowDelete}
            onToggleActive={onToggleActive}
            repair={repair}
            togglingId={togglingId}
          />
        ))}
      </div>
    </>
  );
}

function RepairListLoading() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          className="h-20 animate-pulse rounded-xl bg-surface-container-high"
          key={`skeleton-${String(i)}`}
        />
      ))}
    </div>
  );
}

export default function RepairsPage() {
  const { t } = useTranslation();
  const {
    repairs,
    isLoading,
    error,
    fetchRepairs,
    createRepair,
    updateRepair,
    deleteRepair,
    toggleRepairActive,
    clearError,
  } = useRepairCatalogStore();
  const [activeCategory, setActiveCategory] = useState<RepairCategory | "ALL">(
    "ALL"
  );
  const [activeSort, setActiveSort] = useState<SortOption>("recently_added");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRepair, setEditingRepair] = useState<RepairCatalog | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    isError: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    fetchRepairs();
  }, [fetchRepairs]);

  const repairItems = useMemo(() => repairs.map(toRepairItem), [repairs]);

  const deletingRepair = useMemo(
    () => repairItems.find((r) => r.id === deletingId) ?? null,
    [repairItems, deletingId]
  );

  const handleAddRepair = async (data: RepairFormData) => {
    await createRepair({
      name: data.name,
      category: data.category,
      defaultPrice: Number(data.basePrice),
    });
  };

  const handleEditRepair = (item: RepairItem) => {
    const repair = repairs.find((r) => r.id === item.id);
    if (repair) {
      setEditingRepair(repair);
    }
  };

  const handleEditSubmit = async (data: RepairFormData) => {
    if (!editingRepair) {
      return;
    }
    try {
      await updateRepair(editingRepair.id, {
        name: data.name,
        category: data.category,
        defaultPrice: Number(data.basePrice),
      });
      setEditingRepair(null);
      showToast(t("repair_updated_successfully"));
    } catch {
      showToast(t("errors.update_repair"), true);
    }
  };

  const handleDeleteRepair = async () => {
    if (!deletingId) {
      return;
    }
    const id = deletingId;
    setDeletingId(null);
    try {
      await deleteRepair(id);
      showToast(t("repair_deleted_successfully"));
    } catch {
      showToast(t("failed_to_delete_repair"), true);
    }
  };

  const handleToggleActive = async (item: RepairItem) => {
    setTogglingId(item.id);
    try {
      await toggleRepairActive(item.id, !item.isActive);
      showToast(t("repair_status_changed"));
    } catch {
      showToast(t("errors.toggle_repair_status"), true);
    } finally {
      setTogglingId(null);
    }
  };

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ isError, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const { avgPrice, topCategory } = useMemo(() => {
    if (repairItems.length === 0) {
      return { avgPrice: 0, topCategory: "HARDWARE" as RepairCategory };
    }
    const avg = Math.round(
      repairItems.reduce((sum, r) => sum + r.basePrice, 0) / repairItems.length
    );
    const counts = repairItems.reduce(
      (acc, r) => {
        acc[r.category] = (acc[r.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    const top = Object.entries(counts).sort(
      ([, a], [, b]) => b - a
    )[0]?.[0] as RepairCategory;
    return { avgPrice: avg, topCategory: top };
  }, [repairItems]);

  const filtered = repairItems.filter((r) => {
    const matchesCategory =
      activeCategory === "ALL" || r.category === activeCategory;
    const matchesSearch =
      searchQuery === "" ||
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.code.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (activeSort) {
      case "price_low_high":
        return a.basePrice - b.basePrice;
      case "price_high_low":
        return b.basePrice - a.basePrice;
      case "az":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  return (
    <>
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-extrabold font-headline text-2xl text-on-surface tracking-tight md:text-3xl">
            {t("repair_services")}
          </h2>
          <p className="mt-1 font-medium text-on-surface-variant text-sm md:text-base">
            {t("repair_services_subtitle")}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-surface-container-low p-4">
              <span className="block font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("total_services")}
              </span>
              <span className="block font-extrabold font-headline text-on-surface text-xl tracking-tight">
                {repairItems.length}
              </span>
            </div>
            <div className="rounded-2xl bg-surface-container-low p-4">
              <span className="block font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("most_popular")}
              </span>
              <span className="block font-extrabold font-headline text-on-surface text-xl tracking-tight">
                {t(`repair_category.${topCategory}`)}
              </span>
            </div>
            <div className="rounded-2xl bg-surface-container-low p-4">
              <span className="block font-medium text-on-surface-variant text-xs uppercase tracking-wide">
                {t("avg_price")}
              </span>
              <span className="block font-extrabold font-mono text-primary text-xl tracking-tight">
                {formatCurrency(avgPrice)}
              </span>
            </div>
          </div>
        </div>
        <Button
          icon="add"
          onClick={() => setShowAddModal(true)}
          size="md"
          type="button"
          variant="primary-gradient"
        >
          {t("add_service")}
        </Button>
      </div>

      {error && (
        <div
          className="mb-6 flex items-center gap-3 rounded-xl bg-error-container px-4 py-3"
          role="alert"
        >
          <span className="material-symbols-outlined text-on-error-container">
            error
          </span>
          <p className="flex-1 font-bold text-on-error-container text-sm">
            {error}
          </p>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-error-container transition-colors hover:bg-on-error-container/10"
            onClick={clearError}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      <div className="mb-6">
        <RepairFilters
          activeCategory={activeCategory}
          activeSort={activeSort}
          onCategoryChange={setActiveCategory}
          onSearchChange={setSearchQuery}
          onSortChange={setActiveSort}
          searchQuery={searchQuery}
        />
      </div>

      <div className="mb-6">
        {isLoading && <RepairListLoading />}
        {!isLoading && sorted.length === 0 && (
          <RepairListEmpty
            onClearFilters={() => {
              setActiveCategory("ALL");
              setSearchQuery("");
              setActiveSort("recently_added");
            }}
          />
        )}
        {!isLoading && sorted.length > 0 && (
          <RepairListContent
            onEdit={handleEditRepair}
            onShowDelete={setDeletingId}
            onToggleActive={handleToggleActive}
            sorted={sorted}
            togglingId={togglingId}
          />
        )}
      </div>

      <CategoryHealth repairs={repairItems} />

      <AddRepairModal
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddRepair}
        open={showAddModal}
      />

      {editingRepair && (
        <AddRepairModal
          editingRepair={editingRepair}
          onClose={() => setEditingRepair(null)}
          onSubmit={handleEditSubmit}
          open
        />
      )}

      <DeleteRepairDialog
        onClose={() => setDeletingId(null)}
        onConfirm={handleDeleteRepair}
        open={deletingId !== null}
        repairName={deletingRepair?.name ?? ""}
      />

      {toast && (
        <div
          aria-live="polite"
          className={`fixed end-6 bottom-6 z-50 flex animate-[fadeSlideUp_0.3s_ease-out] items-center gap-2 rounded-2xl px-5 py-3 font-bold text-sm shadow-2xl ${
            toast.isError
              ? "bg-error text-on-error"
              : "bg-primary text-on-primary"
          }`}
          role="status"
        >
          <span className="material-symbols-outlined text-[18px]">
            {toast.isError ? "error" : "check_circle"}
          </span>
          {toast.message}
        </div>
      )}
    </>
  );
}
