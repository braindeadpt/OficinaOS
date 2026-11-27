import type {
  PontoActEntryDTO,
  PontoActExportResponse,
  PontoActWorkerDTO,
} from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => {
  const autoTable = vi.fn();
  const save = vi.fn();
  const setFontSize = vi.fn();
  const setPage = vi.fn();
  const text = vi.fn();
  class JsPdf {
    getNumberOfPages = vi.fn(() => 1);
    save = save;
    setFontSize = setFontSize;
    setPage = setPage;
    text = text;
  }
  return { autoTable, JsPdf, save, text };
});

vi.mock("jspdf", () => ({ default: pdfMocks.JsPdf }));
vi.mock("jspdf-autotable", () => ({ default: pdfMocks.autoTable }));

const { buildActPdfRows, buildActSheetRows, downloadActPdf } = await import(
  "../act-export"
);

const t = ((key: string) => key) as TFunction;

function entry(
  id: string,
  at: string,
  overrides: Partial<PontoActEntryDTO> = {}
): PontoActEntryDTO {
  return {
    at,
    corrections: [],
    corrects: null,
    correctsId: null,
    createdAt: at,
    createdByName: null,
    effectiveStatus: "APROVADO",
    id,
    reason: null,
    status: "APROVADO",
    superseded: false,
    transport: "MANUAL",
    type: "SAIDA",
    validations: [],
    ...overrides,
  };
}

describe("exportação ACT em PDF", () => {
  it("mostra a correção ao lado do original, com autor, data e motivo", async () => {
    const original = entry("original", "2026-01-05T17:00:00.000Z", {
      corrections: [
        {
          at: "2026-01-05T18:00:00.000Z",
          createdAt: "2026-01-06T09:00:00.000Z",
          createdByName: "Gestora",
          effectiveStatus: "APROVADO",
          id: "correction",
          reason: "esquecimento",
          status: "APROVADO",
          transport: "MANUAL",
          type: "SAIDA",
          validations: [],
        },
      ],
      superseded: true,
    });
    const correction = entry("correction", "2026-01-05T18:00:00.000Z", {
      corrects: {
        at: "2026-01-05T17:00:00.000Z",
        createdAt: "2026-01-05T17:00:00.000Z",
        createdByName: null,
        effectiveStatus: "APROVADO",
        id: "original",
        reason: null,
        status: "APROVADO",
        transport: "WHATSAPP_META",
        type: "SAIDA",
        validations: [],
      },
      correctsId: "original",
      createdAt: "2026-01-06T09:00:00.000Z",
      createdByName: "Gestora",
      reason: "esquecimento",
    });
    const data: PontoActExportResponse = {
      company: {
        address: "Rua A",
        locality: "Porto",
        name: "Oficina",
        phone: null,
        taxId: "501234567",
      },
      contentHash: "a".repeat(64),
      exportedAt: "2026-01-10T12:00:00.000Z",
      exportedBy: { id: "owner", name: "Dono", username: "dono" },
      hashAlgorithm: "SHA-256",
      hashInput: "canonical-json-v1",
      period: {
        from: "2026-01-05",
        timeZone: "Europe/Lisbon",
        to: "2026-01-05",
      },
      workers: [
        {
          days: [
            {
              date: "2026-01-05",
              entries: [original, correction],
              pauseMinutes: 0,
              weekStart: "2026-01-05",
              workedMinutes: 540,
            },
          ],
          externalWork: false,
          name: "Ana",
          scheduleEnd: "18:00",
          scheduleExempt: true,
          scheduleStart: "09:00",
          totalMinutes: 540,
          userId: "u1",
          username: "ana",
          weeks: [
            { end: "2026-01-11", start: "2026-01-05", workedMinutes: 540 },
          ],
        },
      ],
    };

    await downloadActPdf(data, "pt", t);

    expect(pdfMocks.autoTable).toHaveBeenCalledTimes(1);
    const options = pdfMocks.autoTable.mock.calls[0]?.[1] as {
      body: string[][];
    };
    const originalRow = options.body.find(
      (row) =>
        row[5]?.includes("Gestora") && row[4]?.includes("ponto.act_superseded")
    );
    expect(originalRow?.[4]).toContain("ponto.act_superseded");
    expect(originalRow?.[5]).toContain("Gestora");
    expect(originalRow?.[5]).toContain("esquecimento");
    const correctionRow = options.body.find((row) =>
      row[5]?.includes("ponto.act_corrects")
    );
    expect(correctionRow?.[5]).toContain("17:00");
    expect(options.body.some((row) => row[2] === "ponto.act_day_total")).toBe(
      true
    );
    expect(options.body.some((row) => row[2] === "ponto.act_week_total")).toBe(
      true
    );
    expect(pdfMocks.text).toHaveBeenCalledWith(
      expect.stringContaining(`SHA-256: ${"a".repeat(64)}`),
      14,
      200
    );
    expect(pdfMocks.save).toHaveBeenCalledWith(
      "act-ponto-2026-01-05_2026-01-05.pdf"
    );
  });
});

describe("correções à exportação ACT (revisão #208)", () => {
  const period = { from: "2026-07-01", to: "2026-07-31" };

  function worker(
    overrides: Partial<PontoActWorkerDTO> = {}
  ): PontoActWorkerDTO {
    return {
      days: [],
      externalWork: false,
      name: "Ana",
      scheduleEnd: "18:00",
      scheduleExempt: false,
      scheduleStart: "09:00",
      totalMinutes: 0,
      userId: "u1",
      username: "ana",
      weeks: [],
      ...overrides,
    };
  }

  it("referências a correções usam a data do fuso da loja, não UTC", () => {
    // Verão em Lisboa (UTC+1): 23:20 UTC de 30 jun são 00:20 de 1 jul na
    // loja. O bug misturava a hora local com a data UTC e o documento legal
    // dizia "30 jun 00:20" — um dia que nem sequer está no período.
    const corrected = entry("corr", "2026-06-30T23:20:00.000Z", {
      corrects: {
        at: "2026-06-29T17:00:00.000Z",
        createdAt: "2026-06-29T17:00:00.000Z",
        createdByName: null,
        effectiveStatus: "APROVADO",
        id: "orig",
        reason: null,
        status: "APROVADO",
        transport: "MANUAL",
        type: "SAIDA",
        validations: [],
      },
      correctsId: "orig",
      reason: "esquecimento",
    });
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-01",
            entries: [corrected],
            pauseMinutes: 0,
            weekStart: "2026-06-29",
            workedMinutes: 0,
          },
        ],
      }),
      "pt",
      "Europe/Lisbon",
      t,
      period
    );
    const details = rows.map((row) => row[5] ?? "").join("\n");
    expect(details).toContain("01/07/2026");
    expect(details).not.toContain("30/06/2026, 00:20");
  });

  it("semana cortada pelo período é rotulada como parcial com os dias dentro do período", () => {
    const partialT = ((key: string, opts?: { from?: string; to?: string }) =>
      key === "ponto.act_week_partial"
        ? `Semana parcial (${opts?.from}–${opts?.to}, dias dentro do período)`
        : key) as TFunction;
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-01",
            entries: [],
            pauseMinutes: 0,
            weekStart: "2026-06-29",
            workedMinutes: 480,
          },
        ],
        totalMinutes: 480,
        weeks: [{ end: "2026-07-05", start: "2026-06-29", workedMinutes: 480 }],
      }),
      "pt",
      "Europe/Lisbon",
      partialT,
      period
    );
    const weekRow = rows.find((row) => row[2] === "ponto.act_week_total");
    expect(weekRow?.[0]).toBe(
      "Semana parcial (01/07–05/07, dias dentro do período)"
    );
  });

  it("semana completa dentro do período mantém o rótulo segunda–domingo", () => {
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-07",
            entries: [],
            pauseMinutes: 0,
            weekStart: "2026-07-06",
            workedMinutes: 480,
          },
        ],
        totalMinutes: 480,
        weeks: [{ end: "2026-07-12", start: "2026-07-06", workedMinutes: 480 }],
      }),
      "pt",
      "Europe/Lisbon",
      t,
      period
    );
    const weekRow = rows.find((row) => row[2] === "ponto.act_week_total");
    expect(weekRow?.[0]).toBe("2026-07-06 → 2026-07-12");
  });

  it("o Excel identifica o trabalhador por nome + utilizador", () => {
    const data = {
      company: {
        address: null,
        locality: null,
        name: "Oficina",
        phone: null,
        taxId: null,
      },
      contentHash: "a".repeat(64),
      exportedAt: "2026-07-31T12:00:00.000Z",
      exportedBy: { id: "owner", name: "Dono", username: "dono" },
      hashAlgorithm: "SHA-256",
      hashInput: "canonical-json-v1",
      period: { ...period, timeZone: "Europe/Lisbon" },
      workers: [worker()],
    } as PontoActExportResponse;
    const rows = buildActSheetRows(data, "pt", t);
    const workerRow = rows.find(
      (row) => row[6]?.value === "ponto.act_no_records"
    );
    expect(workerRow?.[0]?.value).toBe("Ana (@ana)");
  });

  it("cada validação aparece atribuída à picagem a que pertence", () => {
    // Original aprovada + correção recusada: sem rótulos distintos, a
    // aprovação do original parecia pertencer à correção.
    const correction = {
      at: "2026-07-02T09:00:00.000Z",
      createdAt: "2026-07-02T08:30:00.000Z",
      createdByName: "Gestora",
      effectiveStatus: "RECUSADO" as const,
      id: "corr",
      reason: "esquecimento",
      status: "POR_VALIDAR" as const,
      transport: "MANUAL" as const,
      type: "SAIDA" as const,
      validations: [
        {
          at: "2026-07-03T10:00:00.000Z",
          byUserName: "Dono",
          decision: "RECUSADO" as const,
          note: "hora errada",
        },
      ],
    };
    const original = entry("orig", "2026-07-01T17:00:00.000Z", {
      corrections: [correction],
      superseded: true,
      validations: [
        {
          at: "2026-07-01T18:00:00.000Z",
          byUserName: "Dono",
          decision: "APROVADO" as const,
          note: null,
        },
      ],
    });
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-01",
            entries: [original],
            pauseMinutes: 0,
            weekStart: "2026-06-29",
            workedMinutes: 0,
          },
        ],
      }),
      "pt",
      "Europe/Lisbon",
      t,
      period
    );
    const details = rows.map((row) => row[5] ?? "").join("\n");
    // a decisão da correção é atribuída à correção…
    expect(details).toContain("ponto.act_validation_of_correction: ponto.act_status_recusado");
    // …e a decisão do original ao original — nunca misturadas
    expect(details).toContain("ponto.act_validation_of_original: ponto.act_status_aprovado");
  });

  it("referência à picagem ligada usa a data do momento da picagem no fuso da loja", () => {
    // A picagem ligada atravessa ela própria a meia-noite local: 23:50 UTC
    // de 30 jun são 00:50 de 1 jul em Lisboa (verão). A criação foi dias
    // depois — se a data viesse da criação, aparecia 03/07 em vez de 01/07.
    const corrected = entry("corr", "2026-07-02T09:00:00.000Z", {
      corrects: {
        at: "2026-06-30T23:50:00.000Z",
        createdAt: "2026-07-03T10:00:00.000Z",
        createdByName: null,
        effectiveStatus: "APROVADO",
        id: "orig",
        reason: null,
        status: "APROVADO",
        transport: "MANUAL",
        type: "SAIDA",
        validations: [],
      },
      correctsId: "orig",
      reason: "esquecimento",
    });
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-02",
            entries: [corrected],
            pauseMinutes: 0,
            weekStart: "2026-06-29",
            workedMinutes: 0,
          },
        ],
      }),
      "pt",
      "Europe/Lisbon",
      t,
      period
    );
    const details = rows.map((row) => row[5] ?? "").join("\n");
    // o momento da picagem ligada aparece no dia local certo…
    expect(details).toContain("01/07/2026, 00:50");
    // …e não no dia UTC nem confundido com a data de criação
    expect(details).not.toContain("30/06/2026, 23:50");
  });

  it("correções ligadas mostram estado, decisão, autor e data da validação", () => {
    const correction = {
      at: "2026-07-02T09:00:00.000Z",
      createdAt: "2026-07-02T08:30:00.000Z",
      createdByName: "Gestora",
      effectiveStatus: "APROVADO" as const,
      id: "corr",
      reason: "esquecimento",
      status: "POR_VALIDAR" as const,
      transport: "MANUAL" as const,
      type: "SAIDA" as const,
      validations: [
        {
          at: "2026-07-03T10:00:00.000Z",
          byUserName: "Dono",
          decision: "APROVADO" as const,
          note: "conferido",
        },
      ],
    };
    const original = entry("orig", "2026-07-01T17:00:00.000Z", {
      corrections: [correction],
      superseded: true,
    });
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-01",
            entries: [original],
            pauseMinutes: 0,
            weekStart: "2026-06-29",
            workedMinutes: 0,
          },
        ],
      }),
      "pt",
      "Europe/Lisbon",
      t,
      period
    );
    const details = rows.map((row) => row[5] ?? "").join("\n");
    expect(details).toContain("ponto.act_status_aprovado");
    expect(details).toContain("ponto.act_validation");
    expect(details).toContain("Dono");
    expect(details).toContain("conferido");
  });

  it("isenção de horário é rotulada como regime à data da exportação", () => {
    const rows = buildActPdfRows(
      worker({
        days: [
          {
            date: "2026-07-01",
            entries: [],
            pauseMinutes: 0,
            weekStart: "2026-06-29",
            workedMinutes: 480,
          },
        ],
        scheduleExempt: true,
        totalMinutes: 480,
      }),
      "pt",
      "Europe/Lisbon",
      t,
      period
    );
    const totalRow = rows.find((row) => row[2] === "ponto.act_worker_total");
    expect(totalRow?.[5]).toContain("ponto.act_schedule_exempt");
    expect(totalRow?.[5]).toContain("ponto.act_regime_at_export");
  });
});
