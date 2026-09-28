import { describe, expect, it } from "vitest";
import { isLowStock } from "../stock-level";

describe("isLowStock", () => {
  it("flags stock equal to reorder level", () => {
    expect(isLowStock({ reorderLevel: 3, stockQuantity: 3 })).toBe(true);
  });

  it("flags stock below reorder level", () => {
    expect(isLowStock({ reorderLevel: 3, stockQuantity: 1 })).toBe(true);
  });

  it("flags zero stock when a reorder level exists", () => {
    expect(isLowStock({ reorderLevel: 2, stockQuantity: 0 })).toBe(true);
  });

  it("does not flag stock above reorder level", () => {
    expect(isLowStock({ reorderLevel: 3, stockQuantity: 4 })).toBe(false);
  });

  it("never flags parts without a reorder level", () => {
    expect(isLowStock({ reorderLevel: 0, stockQuantity: 0 })).toBe(false);
  });
});
