import { describe, expect, it } from "vitest";
import { commissionGross, orderMargin } from "./business-finance";
import {
  agreementFields,
  messageFields,
  orderFields,
} from "./schemas/business";

const base = {
  costGross: "123",
  quoteGross: "246",
  costVatRate: "23",
  saleVatRate: "23",
  recoverInputVat: true,
};
describe("order margin after VAT", () => {
  it("deducts VAT before calculating profit and margin", () => {
    expect(orderMargin(base)).toEqual({
      costNet: "100.00",
      revenueNet: "200.00",
      profitAfterVat: "100.00",
      vatBalance: "23.00",
      marginPercent: 50,
    });
  });
  it("uses different purchase and sales VAT rates", () => {
    expect(
      orderMargin({ ...base, costGross: "106", costVatRate: "6" })
        .profitAfterVat
    ).toBe("100.00");
  });
  it("treats non-deductible input VAT as a cost", () => {
    expect(orderMargin({ ...base, recoverInputVat: false })).toMatchObject({
      costNet: "123.00",
      profitAfterVat: "77.00",
      vatBalance: "46.00",
      marginPercent: 38.5,
    });
  });
  it("handles zero quotes without division by zero", () => {
    expect(orderMargin({ ...base, quoteGross: "0" })).toMatchObject({
      profitAfterVat: "-100.00",
      marginPercent: null,
    });
  });
  it("rounds tax to cents and retains losses", () => {
    expect(
      orderMargin({ ...base, costGross: "0.03", quoteGross: "0.01" })
    ).toMatchObject({
      profitAfterVat: "-0.01",
      costNet: "0.02",
      revenueNet: "0.01",
    });
  });
  it("keeps large amounts exact", () => {
    expect(
      orderMargin({
        ...base,
        costGross: "9999999999.99",
        costVatRate: "0",
        quoteGross: "0",
      }).profitAfterVat
    ).toBe("-9999999999.99");
  });
  it("calculates commissions on the net basis then adds VAT", () => {
    expect(commissionGross("1000", "10", "23")).toBe("123.00");
  });
});
describe("business input boundaries", () => {
  it("rejects negative values, excessive precision and invalid VAT", () => {
    for (const field of [
      { costGross: "-1" },
      { quoteGross: "1.001" },
      { saleVatRate: "101" },
    ]) {
      expect(orderFields.safeParse({ title: "Order", ...field }).success).toBe(
        false
      );
    }
  });
  it("only accepts HTTP purchase links", () => {
    for (const purchaseUrl of ["javascript:alert(1)", "file:///secret"]) {
      expect(
        orderFields.safeParse({ title: "Order", purchaseUrl }).success
      ).toBe(false);
    }
  });
  it("cannot claim that a manually recorded message was sent", () => {
    expect(
      messageFields.safeParse({
        subject: "Draft",
        body: "Hello",
        channel: "EMAIL",
        direction: "OUTBOUND",
        deliveryStatus: "SENT",
      }).success
    ).toBe(false);
  });
  it("rejects agreement end dates before the start", () => {
    expect(
      agreementFields.safeParse({
        kind: "LICENSE",
        title: "License",
        amountGross: "10",
        vatRate: "0",
        commissionBasisNet: "0",
        commissionRate: "0",
        paidGross: "0",
        interval: "YEARLY",
        status: "ACTIVE",
        startsAt: "2026-10-17T00:00:00Z",
        endsAt: "2026-10-01T00:00:00Z",
      }).success
    ).toBe(false);
  });
});
