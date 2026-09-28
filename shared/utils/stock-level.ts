interface StockLevelInput {
  reorderLevel: number;
  stockQuantity: number;
}

/**
 * Single source of truth for the low-stock threshold: a part needs
 * restock when a reorder level is configured and current stock has
 * reached it. Shared by the owner alert service, the POS grid and the
 * catalog badge/filter so they can never drift apart.
 */
export function isLowStock({
  reorderLevel,
  stockQuantity,
}: StockLevelInput): boolean {
  return reorderLevel > 0 && stockQuantity <= reorderLevel;
}
