import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";
import { downloadCsv } from "@/lib/export-csv";

interface StockMovement {
  balanceAfter: number;
  createdAt: string;
  createdBy: { id: string; name: string; username: string };
  id: string;
  note: string | null;
  quantity: number;
  reference: string | null;
  supplier: string | null;
  type: "PURCHASE" | "CONSUMPTION" | "RETURN" | "ADJUSTMENT";
  unitCost: string | null;
}

const TYPE_CONFIG: Record<
  StockMovement["type"],
  { icon: string; tone: string }
> = {
  ADJUSTMENT: {
    icon: "tune",
    tone: "bg-secondary-container text-on-secondary-container",
  },
  CONSUMPTION: {
    icon: "build",
    tone: "bg-surface-container-high text-on-surface-variant",
  },
  PURCHASE: {
    icon: "shopping_cart",
    tone: "bg-primary-container text-on-primary-container",
  },
  RETURN: {
    icon: "undo",
    tone: "bg-tertiary-container text-on-tertiary-container",
  },
};

export default function StockMovementsDialog({
  onClose,
  partId,
  partName,
}: {
  onClose: () => void;
  partId: string;
  partName: string;
}) {
  const { t } = useTranslation();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const fetchMovements = useCallback(async () => {
    try {
      const res = await api.get(`/parts/${partId}/stock-movements`);
      setMovements(res.data.movements);
    } catch {
      // Dialog shows the error state via the empty list.
    } finally {
      setIsLoading(false);
    }
  }, [partId]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  const handleExportCsv = useCallback(async () => {
    setIsExporting(true);
    try {
      // Walk every page: the export must contain the full history,
      // not just the first 30 rows shown in the dialog.
      const all: StockMovement[] = [];
      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const res = await api.get(`/parts/${partId}/stock-movements`, {
          params: { limit: 100, ...(cursor ? { cursor } : {}) },
        });
        const { movements: page, nextCursor } = res.data;
        all.push(...page);
        cursor = nextCursor ?? undefined;
        hasMore = Boolean(nextCursor);
      }

      // Ledger convention: oldest first (the dialog shows newest first).
      const chronological = [...all].reverse();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const slug = partName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      downloadCsv(
        `stock-movements-${slug || "part"}-${stamp}.csv`,
        [
          t("parts_movements_export_date"),
          t("parts_movements_export_type"),
          t("parts_purchase_quantity"),
          t("parts_movements_balance"),
          t("parts_purchase_unit_cost"),
          t("parts_purchase_supplier"),
          t("parts_purchase_reference"),
          t("parts_movements_export_user"),
          t("parts_movements_export_note"),
        ],
        chronological.map((m) => [
          m.createdAt,
          t(`parts_movement_${m.type.toLowerCase()}`),
          m.quantity,
          m.balanceAfter,
          m.unitCost,
          m.supplier,
          m.reference,
          m.createdBy?.name ?? m.createdBy?.username ?? "",
          m.note,
        ])
      );
      toast.success(t("parts_movements_export_done"));
    } catch {
      toast.error(t("parts_movements_export_failed"));
    } finally {
      setIsExporting(false);
    }
  }, [partId, partName, t]);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-overlay"
        onClick={onClose}
        type="button"
      />
      <div className="modal-surface relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface-container-lowest shadow-2xl">
        <div className="flex items-center justify-between border-outline-variant border-b px-6 py-4">
          <div>
            <h2 className="font-bold font-headline text-lg text-on-surface">
              {t("parts_movements_title")}
            </h2>
            <p className="font-label text-on-surface-variant text-xs">
              {partName}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              aria-label={t("parts_movements_export")}
              className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high disabled:opacity-50"
              disabled={isExporting || (!isLoading && movements.length === 0)}
              onClick={handleExportCsv}
              title={t("parts_movements_export")}
              type="button"
            >
              <span aria-hidden="true" className="material-symbols-outlined">
                {isExporting ? "progress_activity" : "download"}
              </span>
            </button>
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
              onClick={onClose}
              type="button"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <span className="material-symbols-outlined animate-spin text-on-surface-variant">
                progress_activity
              </span>
            </div>
          )}

          {!isLoading && movements.length === 0 && (
            <p className="py-8 text-center text-on-surface-variant text-sm">
              {t("parts_movements_empty")}
            </p>
          )}

          <ul className="space-y-2">
            {movements.map((m) => {
              const config = TYPE_CONFIG[m.type] ?? TYPE_CONFIG.CONSUMPTION;
              const isIn = m.quantity > 0;
              return (
                <li
                  className="flex items-center gap-3 rounded-xl bg-surface-container-low p-3"
                  key={m.id}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.tone}`}
                  >
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-[18px]"
                    >
                      {config.icon}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold font-headline text-on-surface text-sm">
                      {t(`parts_movement_${m.type.toLowerCase()}`)}
                      {m.supplier ? ` · ${m.supplier}` : ""}
                    </p>
                    <p className="font-label text-on-surface-variant text-xs">
                      {new Date(m.createdAt).toLocaleString()} ·{" "}
                      {m.createdBy?.name ?? "—"}
                      {m.reference ? ` · ${m.reference}` : ""}
                    </p>
                    {m.note && (
                      <p className="truncate font-body text-on-surface-variant text-xs">
                        {m.note}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-end">
                    <span
                      className={`font-bold font-mono text-sm ${
                        isIn ? "text-primary" : "text-error"
                      }`}
                    >
                      {isIn ? "+" : ""}
                      {m.quantity}
                    </span>
                    <p className="font-label text-on-surface-variant text-xs">
                      {t("parts_movements_balance")}: {m.balanceAfter}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
