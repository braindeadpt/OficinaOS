/**
 * Client-side table import: reads .csv / .tsv / .xlsx files into objects
 * keyed by header name, ready to POST to /api/import/*.
 */

const BOM_RE = /^﻿/;
const XLSX_RE = /\.xlsx?$/i;

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(BOM_RE, "");

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
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
    } else if (ch === ";" || ch === "," || ch === "\t") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  pushRow();
  return rows;
}

function toObjects(table: string[][]): Record<string, string>[] {
  if (table.length < 2) {
    return [];
  }
  const headers = table[0].map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_")
  );
  return table.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) {
        obj[h] = (cells[i] ?? "").trim();
      }
    });
    return obj;
  });
}

async function readXlsx(file: File): Promise<string[][]> {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const rows = sheets[0]?.data ?? [];
  return rows.map((r) => r.map((c) => (c === null ? "" : String(c))));
}

/** Reads a CSV/TSV/XLSX file into row objects keyed by lowercased headers. */
export async function readTableFile(
  file: File
): Promise<Record<string, string>[]> {
  if (XLSX_RE.test(file.name)) {
    return toObjects(await readXlsx(file));
  }
  return toObjects(parseCsv(await file.text()));
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
  },
  jobs: {
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
  },
};

export type ImportTarget = keyof typeof ALIASES;

/** Maps imported row objects to canonical field names + coerces numbers. */
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
      if (["price", "stock", "warrantyDays"].includes(canonical)) {
        const n = Number(value.replace(",", ".").replace(/[^\d.-]/g, ""));
        if (Number.isFinite(n)) {
          out[canonical] = n;
        }
      } else {
        out[canonical] = value;
      }
    }
    return out;
  });
}
