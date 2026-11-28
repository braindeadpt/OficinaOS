// PDF mensal do próprio trabalhador (art. 15.º RGPD) — gerado na app,
// servido por link de uso único. PDF escrito à mão: o documento é texto
// simples com Helvetica base-14 (WinAnsi cobre os acentos pt-PT) e um
// gerador mínimo evita arrastar jspdf+canvg+html2canvas para o bundle
// portable do servidor (o probe do CI despoja deps de frontend).

import {
  fmtHoursMs,
  type MonthSummary,
  type RegistosEntry,
} from "./registos.js";
import { PONTO_TEXT } from "./transport.js";

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

function hhmm(at: Date, tz: string): string {
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

/** CP1252/WinAnsi: latin-1 cobre pt-PT; a pontuação tipográfica vive no
 *  intervalo 0x80-0x9F — mapeada aqui (’ “ ” – — • € ‹ ›). O resto vira «?». */
const CP1252_HIGH: Record<string, string> = {
  "\u2018": "\x91",
  "\u2019": "\x92",
  "\u201c": "\x93",
  "\u201d": "\x94",
  "\u2013": "\x96",
  "\u2014": "\x97",
  "\u2022": "\x95",
  "\u20ac": "\x80",
  "\u2039": "\x8b",
  "\u203a": "\x9b",
  "\u2026": "\x85",
};

function pdfText(s: string): string {
  return s
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .split("")
    .map((c) => {
      if (c.charCodeAt(0) <= 255) {
        return c;
      }
      return CP1252_HIGH[c] ?? "?";
    })
    .join("");
}

interface PdfPage {
  lines: { size: number; text: string; x: number; y: number }[];
}

function buildPages(input: {
  entries: RegistosEntry[];
  monthLabel: string;
  shopName: string;
  summary: MonthSummary;
  tz: string;
  workerName: string;
}): PdfPage[] {
  const { entries, monthLabel, shopName, summary, tz, workerName } = input;
  const pages: PdfPage[] = [];
  let page: PdfPage = { lines: [] };
  let y = 800;
  const push = (text: string, x: number, size: number, dy: number) => {
    if (y < 60) {
      pages.push(page);
      page = { lines: [] };
      y = 800;
    }
    page.lines.push({ size, text, x, y });
    y -= dy;
  };

  push("Registo de ponto — os meus registos", 170, 15, 20);
  // Mês em linha própria: com nomes compridos não há quebra de linha no
  // PDF e o período desaparecia para fora da página.
  push(`${shopName} — ${workerName}`, 130, 11, 15);
  push(monthLabel, 130, 11, 24);
  push(
    `Dias com registos: ${summary.days}   Horas trabalhadas: ${fmtHoursMs(summary.workedMs)}   Pausas: ${fmtHoursMs(summary.pauseMs)}`,
    50,
    10,
    16
  );
  push(
    `Correções: ${summary.correctionsCount}   Por validar: ${summary.pendingCount}`,
    50,
    10,
    18
  );
  if (summary.hasOpenShift) {
    push(PONTO_TEXT.registosEstimatedHours, 50, 8, 14);
  }
  push(
    "Documento pedido pelo próprio trabalhador (art. 15.º RGPD). Gerado automaticamente pela aplicação da loja.",
    50,
    8,
    24
  );

  let lastDay = "";
  for (const e of entries) {
    const day = dayLabel(e.at, tz);
    const showDay = day === lastDay ? "" : day;
    lastDay = day;
    // Direito de acesso: recusadas e substituídas fazem parte dos
    // registos do próprio — têm de se distinguir das que contam.
    let note = "";
    if (e.superseded) {
      note = " (substituída por correção)";
    } else if (e.validations[0]?.decision === "RECUSADO") {
      note = " (recusada)";
    }
    const line = `${showDay.padEnd(14)}  ${(ENTRY_TYPE_PT[e.type] ?? e.type).padEnd(10)} ${hhmm(e.at, tz)}  ${STATUS_PT[e.status] ?? e.status}${note}`;
    push(line, 50, 10, 14);
  }
  if (entries.length === 0) {
    push("Sem registos neste mês.", 50, 10, 14);
  }
  pages.push(page);
  return pages;
}

/** Serializa páginas como PDF 1.4 com xref correto. */
function serializePdf(pages: PdfPage[]): Buffer {
  const objects: string[] = [];
  // 1: catálogo, 2: pages, 3: fonte; depois 2 objetos por página.
  const pageCount = pages.length;
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[2] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((p, i) => {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    objects[pageObj - 1] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    let stream = "BT\n";
    for (const line of p.lines) {
      stream += `/F1 ${line.size} Tf 1 0 0 1 ${line.x} ${line.y} Tm (${pdfText(line.text)}) Tj\n`;
    }
    stream += "ET";
    objects[contentObj - 1] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  // Comentário binário (bytes > 127) após o cabeçalho — exigido pelo
  // PDF 1.4 quando o ficheiro tem bytes não ASCII (o nosso acento latin-1).
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = out.length;
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

export function buildRegistosPdf(input: {
  entries: RegistosEntry[];
  monthLabel: string;
  shopName: string;
  summary: MonthSummary;
  tz: string;
  workerName: string;
}): Buffer {
  return serializePdf(buildPages(input));
}
