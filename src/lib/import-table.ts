/**
 * Client-side table import: reads .csv / .tsv / .xlsx files into objects
 * keyed by header name, ready to POST to /api/import/*.
 */

import type { ImportRowError } from "@shared/schemas/data-io.schema";

const BOM_RE = /^﻿/;
const XLSX_RE = /\.xlsx$/i;
const XLS_RE = /\.xls$/i;

/** Hard limits — mirrored by the docs and enforced before any parsing. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
/** Zip-bomb guard: xlsx payloads whose entries inflate past this are refused. */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export class ImportFileError extends Error {
  key: string;

  constructor(key: string) {
    super(key);
    this.name = "ImportFileError";
    this.key = key;
  }
}

const DELIMITERS = [";", ",", "\t"] as const;
type Delimiter = (typeof DELIMITERS)[number];

function countDelimiters(line: string): Record<Delimiter, number> {
  const counts: Record<Delimiter, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          i++;
        } else {
          inQuotes = false;
        }
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ";" || ch === "," || ch === "\t") {
      counts[ch] += 1;
    }
  }
  return counts;
}

/**
 * Counts how many times each candidate delimiter appears in the header
 * outside quotes, then picks the most frequent one. Ties resolve to `;`
 * (the Excel-PT default). A header with zero delimiters is a single-column
 * file and still parses under `;`.
 */
function detectDelimiter(headerLine: string): Delimiter {
  const { ";": semi, ",": comma, "\t": tab } = countDelimiters(headerLine);
  if (semi >= comma && semi >= tab) {
    return ";";
  }
  return comma >= tab ? "," : "\t";
}

/** Splits the text into physical lines (handles \n and \r\n, keeps \r out). */
function splitLines(src: string): string[] {
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        if (ch === '"') {
          inQuotes = false;
        }
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
      cur += ch;
    } else if (ch === "\n") {
      lines.push(cur);
      cur = "";
    } else if (ch !== "\r") {
      cur += ch;
    }
  }
  lines.push(cur);
  return lines;
}

function parseLine(line: string, delimiter: Delimiter): string[] {
  const cells: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  cells.push(field);
  return cells;
}

export interface ParsedTable {
  /** Physical 1-based file line each row came from (header is line 1). */
  lines: number[];
  rows: string[][];
}

// Empty lines are skipped but their physical line number is remembered —
// server error rows must map back to the line the user sees in the sheet.
function parseCsvDetailed(text: string): ParsedTable {
  const src = text.replace(BOM_RE, "");
  const lines = splitLines(src);
  const delimiter = detectDelimiter(lines[0] ?? "");
  const rows: string[][] = [];
  const lineNos: number[] = [];
  for (const [idx, line] of lines.entries()) {
    const cells = parseLine(line, delimiter);
    if (cells.length > 1 || cells[0] !== "") {
      rows.push(cells);
      lineNos.push(idx + 1);
    }
  }
  return { lines: lineNos, rows };
}

export function parseCsv(text: string): string[][] {
  return parseCsvDetailed(text).rows;
}

/**
 * Portuguese number format: a comma is the decimal separator and dots are
 * thousands separators. A bare `1.000` (groups of three after a dot) is also
 * thousands — `1.234,56` -> 1234.56, `12,50` -> 12.5, `1.000` -> 1000,
 * `89.9` -> 89.9. Returns null for anything that is not a number — never 0.
 */
const THOUSANDS_GROUPED = /^-?\d{1,3}(\.\d{3})+$/;
const PLAIN_INT = /^-?\d+$/;
const DECIMALS = /^\d+$/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function toFinite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

// PT decimal comma: exactly one comma; the integer part is either plain
// digits or dot-grouped thousands (groups of exactly three).
function parseWithComma(v: string): number | null {
  const idx = v.indexOf(",");
  if (idx !== v.lastIndexOf(",") || idx === 0) {
    return null;
  }
  const intPart = v.slice(0, idx);
  const decPart = v.slice(idx + 1);
  if (!DECIMALS.test(decPart)) {
    return null;
  }
  if (intPart.includes(".")) {
    return THOUSANDS_GROUPED.test(intPart)
      ? toFinite(Number(`${intPart.replace(/\./g, "")}.${decPart}`))
      : null;
  }
  return PLAIN_INT.test(intPart)
    ? toFinite(Number(`${intPart}.${decPart}`))
    : null;
}

const CURRENCY_TOKEN = /€\s*|\s*€/g;

export function parsePtNumber(raw: string): number | null {
  // Tolerate a currency symbol glued to the value: "12,50 €" / "€12,50".
  const v = raw.trim().replace(CURRENCY_TOKEN, "").trim();
  if (v === "") {
    return null;
  }
  if (v.includes(",")) {
    return parseWithComma(v);
  }
  // No comma: dot-grouped thousands (1.000) or a plain/decimal number.
  if (THOUSANDS_GROUPED.test(v)) {
    return toFinite(Number(v.replace(/\./g, "")));
  }
  return PLAIN_NUMBER.test(v) ? toFinite(Number(v)) : null;
}

/** Decodes bytes as strict UTF-8, falling back to Windows-1252 (Excel-PT). */
export function decodeTableBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const EOCD_SIG = 0x06_05_4b_50;
const CDIR_SIG = 0x02_01_4b_50;

/**
 * Sums the uncompressed sizes advertised in the ZIP central directory
 * without inflating anything — cheap defence against zip bombs.
 */
function eocdOffset(view: DataView): number {
  // EOCD lives at the tail; scan the last 64 KiB for its signature.
  const from = Math.max(0, view.byteLength - 65_536);
  for (let i = view.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      return i;
    }
  }
  return -1;
}

/** ZIP64 stores the real size in extra field 0x0001 when the u32 is maxed. */
function zip64Size(view: DataView, start: number, extraLen: number): number {
  let ptr = start;
  const end = start + extraLen;
  while (ptr + 4 <= end) {
    const tag = view.getUint16(ptr, true);
    const len = view.getUint16(ptr + 2, true);
    if (tag === 0x00_01 && len >= 8) {
      return Number(view.getBigUint64(ptr + 4, true));
    }
    ptr += 4 + len;
  }
  return Number.POSITIVE_INFINITY;
}

export function xlsxUncompressedSize(buf: ArrayBuffer): number {
  const view = new DataView(buf);
  const eocd = eocdOffset(view);
  if (eocd === -1) {
    return Number.POSITIVE_INFINITY;
  }
  const entries = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (ptr + 46 > buf.byteLength || view.getUint32(ptr, true) !== CDIR_SIG) {
      return Number.POSITIVE_INFINITY;
    }
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    let size = view.getUint32(ptr + 24, true);
    if (size === 0xff_ff_ff_ff) {
      size = zip64Size(view, ptr + 46 + nameLen, extraLen);
      if (!Number.isFinite(size)) {
        return Number.POSITIVE_INFINITY;
      }
    }
    total += size;
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

// Our own exports prefix formula-dangerous cells with ' — strip it back on
// import so a round-trip doesn't corrupt names ("'=CMD()" -> "=CMD()").
const EXPORTED_GUARD = /^'(?=[=+\-@\t\r])/;

export interface ImportedTable {
  /** Physical file line of each row — header is 1, first data row is 2. */
  lines: number[];
  rows: Record<string, string>[];
}

function toObjects(table: ParsedTable): ImportedTable {
  if (table.rows.length < 2) {
    return { lines: [], rows: [] };
  }
  const headers = table.rows[0].map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_")
  );
  const rows = table.rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) {
        obj[h] = (cells[i] ?? "").trim().replace(EXPORTED_GUARD, "");
      }
    });
    return obj;
  });
  return { lines: table.lines.slice(1), rows };
}

async function readXlsx(file: File): Promise<ParsedTable> {
  const buf = await file.arrayBuffer();
  if (xlsxUncompressedSize(buf) > MAX_XLSX_UNCOMPRESSED_BYTES) {
    throw new ImportFileError("data_io.xlsx_too_large");
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const rows = sheets[0]?.data ?? [];
  return {
    // Sheet row numbers are contiguous — nothing is skipped.
    lines: rows.map((_, i) => i + 1),
    rows: rows.map((r) => r.map((c) => (c === null ? "" : String(c)))),
  };
}

/**
 * Reads a CSV/TSV/XLSX file into row objects keyed by lowercased headers,
 * keeping the physical file line of each row for error reporting.
 */
export async function readTableFile(file: File): Promise<ImportedTable> {
  if (XLS_RE.test(file.name)) {
    // read-excel-file understands .xlsx only — .xls is the old binary format.
    throw new ImportFileError("data_io.xls_unsupported");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportFileError("data_io.file_too_large");
  }
  if (XLSX_RE.test(file.name)) {
    return toObjects(await readXlsx(file));
  }
  const text = decodeTableBuffer(await file.arrayBuffer());
  const table = parseCsvDetailed(text);
  if (table.rows.length - 1 > MAX_IMPORT_ROWS) {
    throw new ImportFileError("data_io.too_many_rows");
  }
  return toObjects(table);
}

/** Header aliases → canonical field names per import target. */
const ALIASES: Record<string, Record<string, string>> = {
  parts: {
    name: "name",
    nome: "name",
    categoria: "category",
    preco: "price",
    preço: "price",
    stock: "stock",
    stockquantity: "stock",
    quantidade: "stock",
    fornecedor: "supplier",
    supplier: "supplier",
    category: "category",
    price: "price",
    reorderlevel: "reorderLevel",
    reorder_level: "reorderLevel",
    stock_minimo: "reorderLevel",
    stock_min: "reorderLevel",
    active: "active",
    ativo: "active",
  },
  repairs: {
    name: "name",
    nome: "name",
    servico: "name",
    serviço: "name",
    categoria: "category",
    category: "category",
    preco: "price",
    preço: "price",
    price: "price",
    garantia_dias: "warrantyDays",
    warrantydays: "warrantyDays",
    warranty_days: "warrantyDays",
    active: "active",
    ativo: "active",
  },
  jobs: {
    jobcode: "jobCode",
    job_code: "jobCode",
    codigo: "jobCode",
    código: "jobCode",
    ref: "externalRef",
    externalref: "externalRef",
    external_ref: "externalRef",
    referencia: "externalRef",
    referência: "externalRef",
    customer_name: "customerName",
    customername: "customerName",
    nome_cliente: "customerName",
    cliente: "customerName",
    customer_phone: "customerPhone",
    customerphone: "customerPhone",
    telefone: "customerPhone",
    phone: "customerPhone",
    customer_email: "customerEmail",
    customeremail: "customerEmail",
    email: "customerEmail",
    device_brand: "deviceBrand",
    devicebrand: "deviceBrand",
    marca: "deviceBrand",
    brand: "deviceBrand",
    device_model: "deviceModel",
    devicemodel: "deviceModel",
    modelo: "deviceModel",
    model: "deviceModel",
    problema: "problem",
    avaria: "problem",
    avaria_reportada: "problem",
    problem: "problem",
    status: "status",
    estado: "status",
    createdat: "createdAt",
    created_at: "createdAt",
    data: "createdAt",
    data_entrada: "createdAt",
    deliveredat: "deliveredAt",
    delivered_at: "deliveredAt",
    data_entrega: "deliveredAt",
  },
};

export type ImportTarget = keyof typeof ALIASES;

const NUMERIC_FIELDS = new Set([
  "price",
  "stock",
  "reorderLevel",
  "warrantyDays",
]);
const BOOLEAN_FIELDS = new Set(["active"]);

function toBoolean(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "sim", "ativo", "active"].includes(s)) {
    return true;
  }
  if (["0", "false", "no", "não", "nao", "inativo", "inactive"].includes(s)) {
    return false;
  }
  return null;
}

/**
 * Maps imported row objects to canonical field names. Numbers use the PT
 * format; a value that is not a number is passed through untouched so the
 * server reports it as a row error — it is never silently coerced to 0.
 */
export function mapRows(
  target: ImportTarget,
  rows: Record<string, string>[]
): Record<string, unknown>[] {
  const aliases = ALIASES[target];
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const canonical = aliases[key];
      if (!canonical || value === "") {
        continue;
      }
      if (NUMERIC_FIELDS.has(canonical)) {
        const n = parsePtNumber(value);
        out[canonical] = n ?? value;
      } else if (BOOLEAN_FIELDS.has(canonical)) {
        const b = toBoolean(value);
        out[canonical] = b ?? value;
      } else {
        out[canonical] = value;
      }
    }
    return out;
  });
}

/**
 * Server error rows are 1-based within the POSTed chunk (index + 2).
 * Map them back to the real file line — chunkLines[i] is the physical line
 * of chunk row i, so both the chunk offset and skipped empty lines are
 * accounted for.
 */
export function remapChunkErrors(
  errors: ImportRowError[] | undefined,
  chunkLines: number[]
): ImportRowError[] {
  return (errors ?? []).map((e) => ({
    ...e,
    row: chunkLines[e.row - 2] ?? e.row,
  }));
}
