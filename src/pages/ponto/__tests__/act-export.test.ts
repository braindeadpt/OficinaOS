import type {
  PontoActEntryDTO,
  PontoActExportResponse,
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

const { downloadActPdf } = await import("../act-export");

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
