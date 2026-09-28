import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";

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

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
    >
      <button
        aria-label={t("close_modal")}
        className="absolute inset-0 bg-on-surface/40"
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
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
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
