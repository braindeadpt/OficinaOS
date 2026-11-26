import type { PontoHoursResponse } from "@shared/types/ponto";
import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => {
  const autoTable = vi.fn();
  const save = vi.fn();
  const setFontSize = vi.fn();
  const text = vi.fn();
  class JsPdf {
    save = save;
    setFontSize = setFontSize;
    text = text;
  }
  return { autoTable, JsPdf, save, setFontSize, text };
});

vi.mock("jspdf", () => ({ default: pdfMocks.JsPdf }));
vi.mock("jspdf-autotable", () => ({ default: pdfMocks.autoTable }));

const { downloadPdf } = await import("../export-tab");
const { formatClock, formatMinutes } = await import("../shared");

const t = ((key: string) => key) as TFunction;

describe("downloadPdf do ponto", () => {
  it("exporta as linhas do mês com correções, faltas e horas efetivas", async () => {
    const data: PontoHoursResponse = {
      days: [
        {
          date: "2026-01-15",
          hours: {
            earlyExitMinutes: 12,
            firstEntradaAt: "2026-01-15T09:30:00.000Z",
            hasCorrection: true,
            lastSaidaAt: "2026-01-15T17:00:00.000Z",
            lateMinutes: 30,
            missingExit: false,
            recusadoCount: 1,
            workedMinutes: 450,
          },
          userId: "u1",
          userName: "Ana",
        },
        {
          date: "2026-01-16",
          hours: {
            earlyExitMinutes: 0,
            firstEntradaAt: "2026-01-16T09:00:00.000Z",
            hasCorrection: false,
            lastSaidaAt: null,
            lateMinutes: 0,
            missingExit: true,
            recusadoCount: 0,
            workedMinutes: 240,
          },
          userId: "u1",
          userName: "Ana",
        },
      ],
      from: "2026-01-01",
      to: "2026-01-31",
    };

    await downloadPdf(data, "Livro de ponto", "Europe/Lisbon", "pt", t);

    expect(pdfMocks.text).toHaveBeenCalledWith("Livro de ponto", 14, 16);
    expect(pdfMocks.autoTable).toHaveBeenCalledTimes(1);
    const options = pdfMocks.autoTable.mock.calls[0]?.[1] as {
      body: unknown[][];
      head: unknown[][];
    };
    expect(options.head[0]).toEqual([
      "ponto.pdf_col_date",
      "ponto.pdf_col_user",
      "ponto.pdf_col_worked",
      "ponto.pdf_col_first",
      "ponto.pdf_col_last",
      "ponto.pdf_col_missing_exit",
      "ponto.pdf_col_late",
      "ponto.pdf_col_early",
      "ponto.pdf_col_corrected",
    ]);
    expect(options.body).toEqual([
      [
        "2026-01-15",
        "Ana",
        formatMinutes(450),
        formatClock("2026-01-15T09:30:00.000Z", "pt", "Europe/Lisbon"),
        formatClock("2026-01-15T17:00:00.000Z", "pt", "Europe/Lisbon"),
        "",
        "30m",
        "12m",
        "X",
      ],
      [
        "2026-01-16",
        "Ana",
        formatMinutes(240),
        formatClock("2026-01-16T09:00:00.000Z", "pt", "Europe/Lisbon"),
        "—",
        "!",
        "",
        "",
        "",
      ],
    ]);
    expect(pdfMocks.save).toHaveBeenCalledWith(
      "ponto-2026-01-01_2026-01-31.pdf"
    );
  });
});
