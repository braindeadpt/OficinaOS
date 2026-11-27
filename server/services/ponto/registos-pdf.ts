// PDF mensal do próprio trabalhador (art. 15.º RGPD) — gerado na app,
// servido por link de uso único. jsPDF corre em Node sem dependências de
// browser para texto simples.

import { jsPDF } from "jspdf";
import {
  fmtHoursMs,
  type MonthSummary,
  type RegistosEntry,
} from "./registos.js";

const ENTRY_TYPE_PT: Record<string, string> = {
  ENTRADA: "Entrada",
  PAUSA: "Pausa",
  SAIDA: "Saída",
  VOLTEI: "Regresso",
};

const STATUS_PT: Record<string, string> = {
  APROVADO: "Aprovado",
  POR_VALIDAR: "Por validar",
  RECUSADO: "Recusado",
};

function hhmmss(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  }).format(at);
}

function dayLabel(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    timeZone: tz,
    weekday: "short",
  }).format(at);
}

export function buildRegistosPdf(input: {
  entries: RegistosEntry[];
  monthLabel: string;
  shopName: string;
  summary: MonthSummary;
  tz: string;
  workerName: string;
}): Buffer {
  const { entries, monthLabel, shopName, summary, tz, workerName } = input;
  const doc = new jsPDF({ unit: "mm" });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(15);
  doc.text("Registo de ponto — os meus registos", pageWidth / 2, y, {
    align: "center",
  });
  y += 8;
  doc.setFontSize(11);
  doc.text(`${shopName} — ${workerName} — ${monthLabel}`, pageWidth / 2, y, {
    align: "center",
  });
  y += 10;

  doc.setFontSize(10);
  doc.text(
    `Dias com registos: ${summary.days}   Horas trabalhadas: ${fmtHoursMs(summary.workedMs)}   Pausas: ${fmtHoursMs(summary.pauseMs)}`,
    14,
    y
  );
  y += 6;
  doc.text(
    `Correções: ${summary.correctionsCount}   Por validar: ${summary.pendingCount}`,
    14,
    y
  );
  y += 8;
  doc.setFontSize(9);
  doc.text(
    "Documento pedido pelo próprio trabalhador (art. 15.º RGPD). Gerado automaticamente pela aplicação da loja.",
    14,
    y
  );
  y += 9;

  doc.setFontSize(10);
  let lastDay = "";
  for (const e of entries) {
    if (y > 275) {
      doc.addPage();
      y = 18;
    }
    const day = dayLabel(e.at, tz);
    const showDay = day === lastDay ? "" : day;
    lastDay = day;
    const line = `${showDay.padEnd(12)}  ${(ENTRY_TYPE_PT[e.type] ?? e.type).padEnd(10)} ${hhmmss(e.at, tz)}  ${STATUS_PT[e.status] ?? e.status}`;
    doc.text(line, 14, y);
    y += 5.6;
  }

  if (entries.length === 0) {
    doc.text("Sem registos neste mês.", 14, y);
  }

  return Buffer.from(doc.output("arraybuffer"));
}
