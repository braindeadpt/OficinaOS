import { describe, expect, it } from "vitest";
import { type CustomerViewCtx, vistaCliente } from "../customer-job-view.js";

const ctx: CustomerViewCtx = {
  currency: "EUR",
  portalApiUrl: "https://cloud.example.com",
  portalEnabled: true,
};

const dec = (n: number) => ({ toNumber: () => n });
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// A fully-loaded job row including fields that must NEVER leak.
const makeJob = () => ({
  accessCode: "secret-portal-token",
  color: "Black",
  depositAmount: dec(50),
  device: { brand: { name: "Apple" }, model: "iPhone 13" },
  estimatedCost: dec(200),
  estimatedDate: new Date(Date.now() + 5 * 86_400_000),
  externalRepairs: [{ expectedReturnAt: null, status: "SENT" }],
  hasLoanerDevice: false,
  jobCode: "REP-2024-000001-ABC",
  loanerReturnedAt: null,
  notes: [
    { content: "Customer-facing note" },
    { content: "Another visible note" },
  ],
  partsUsed: [{ totalCost: dec(40) }],
  partsWaiting: [
    {
      expectedAt: new Date(Date.now() + 2 * 86_400_000),
      partName: "Screen assembly",
      supplier: "SECRET-SUPPLIER",
    },
  ],
  payments: [{ amount: dec(30) }],
  portalPublishedAt: new Date(),
  quotes: [{ amount: dec(200), status: "SENT", version: 1 }],
  repairs: [{ price: dec(160) }],
  status: "WAITING_FOR_PARTS",
  warrantyForJobId: null,
  // Fields that exist on the model but were NOT selected — vistaCliente must
  // never see them. Listed here so the test fails loudly if someone widens
  // VIEW_SELECT without thinking.
  deviceUnlockCode: "1234",
  holdReason: "cliente chato",
  imei: "3534SECRETIMEI",
});

describe("vistaCliente", () => {
  it("produces exactly the allowlisted key set", () => {
    const view = vistaCliente(makeJob() as never, ctx);
    expect(Object.keys(view).sort()).toEqual(
      [
        "aparelho",
        "codigo",
        "dataPrevista",
        "diasAtraso",
        "emPausa",
        "emprestimo",
        "estado",
        "garantia",
        "linkPortal",
        "notasVisiveis",
        "orcamento",
        "pecasEmEspera",
        "reparacaoExterna",
        "valores",
      ].sort()
    );
    expect(Object.keys(view.valores).sort()).toEqual(
      ["emFalta", "estimado", "pago", "sinal"].sort()
    );
    expect(Object.keys(view.pecasEmEspera[0] ?? {}).sort()).toEqual(
      ["chegadaPrevista", "nome"].sort()
    );
  });

  it("never leaks PIN, IMEI, supplier, costs, holdReason or private notes", () => {
    const view = vistaCliente(makeJob() as never, ctx);
    const flat = JSON.stringify(view);
    for (const secret of [
      "1234",
      "3534SECRETIMEI",
      "SECRET-SUPPLIER",
      "cliente chato",
      "accessCode",
    ]) {
      expect(flat).not.toContain(secret);
    }
  });

  it("computes valores (paid total, balance due)", () => {
    const view = vistaCliente(makeJob() as never, ctx);
    expect(view.valores.pago).toContain("30");
    expect(view.valores.estimado).toContain("200");
    // Saldo real: 40 peças + 160 serviços − 50 sinal − 30 pago = 120.
    expect(view.valores.emFalta).toContain("120");
    expect(view.valores.sinal).toContain("50");
  });

  it("reports waiting part expected arrival without supplier", () => {
    const view = vistaCliente(makeJob() as never, ctx);
    expect(view.pecasEmEspera).toHaveLength(1);
    const part = view.pecasEmEspera[0];
    expect(part?.nome).toBe("Screen assembly");
    expect(part?.chegadaPrevista).toMatch(ISO_DATE_RE);
  });

  it("flags ON_HOLD as emPausa without exposing the reason", () => {
    const job = { ...makeJob(), status: "ON_HOLD" };
    const view = vistaCliente(job as never, ctx);
    expect(view.emPausa).toBe(true);
    expect(JSON.stringify(view)).not.toContain("cliente chato");
  });

  it("computes diasAtraso for overdue non-final jobs", () => {
    const job = {
      ...makeJob(),
      estimatedDate: new Date(Date.now() - 3 * 86_400_000),
    };
    expect(vistaCliente(job as never, ctx).diasAtraso).toBe(3);
    const done = { ...job, status: "DONE" };
    expect(vistaCliente(done as never, ctx).diasAtraso).toBe(0);
  });

  it("only includes the portal link when published and entitled", () => {
    const view = vistaCliente(makeJob() as never, ctx);
    expect(view.linkPortal).toContain("/t/");
    const noEnt = vistaCliente(makeJob() as never, {
      ...ctx,
      portalEnabled: false,
    });
    expect(noEnt.linkPortal).toBeNull();
  });
});
