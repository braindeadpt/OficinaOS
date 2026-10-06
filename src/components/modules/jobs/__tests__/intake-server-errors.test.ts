import { describe, expect, it } from "vitest";
import {
  defaultDeliveryDatetime,
  mapServerFieldErrors,
} from "../intake-modal/types";

describe("mapServerFieldErrors", () => {
  it("marks the IMEI field and sends the user back to step 1", () => {
    const mapped = mapServerFieldErrors({
      code: "VALIDATION_ERROR",
      details: { errors: { imei: ["IMEI inválido"] } },
    });
    expect(mapped).toEqual({ errors: { imei: "IMEI inválido" }, step: 1 });
  });

  it("maps payload names onto form fields and picks the earliest step", () => {
    const mapped = mapServerFieldErrors({
      details: {
        errors: {
          depositAmount: ["Valor inválido"],
          deviceModel: ["Indique o modelo"],
          estimatedDate: ["Data inválida"],
        },
      },
    });
    expect(mapped.errors).toEqual({
      deposit: "Valor inválido",
      estimatedDelivery: "Data inválida",
      model: "Indique o modelo",
    });
    expect(mapped.step).toBe(1);
  });

  it("returns no step for errors it cannot attribute to a field", () => {
    expect(mapServerFieldErrors(new Error("boom")).step).toBeNull();
    expect(
      mapServerFieldErrors({ details: { errors: { unknown: ["x"] } } }).step
    ).toBeNull();
  });
});

describe("defaultDeliveryDatetime", () => {
  it("is today at 18:00 in the morning", () => {
    expect(defaultDeliveryDatetime(new Date(2026, 9, 6, 10, 30))).toBe(
      "2026-10-06T18:00"
    );
  });

  it("moves to tomorrow once it is late, never in the past", () => {
    expect(defaultDeliveryDatetime(new Date(2026, 9, 6, 19, 15))).toBe(
      "2026-10-07T18:00"
    );
    expect(defaultDeliveryDatetime(new Date(2026, 9, 31, 17, 0))).toBe(
      "2026-11-01T18:00"
    );
  });
});
