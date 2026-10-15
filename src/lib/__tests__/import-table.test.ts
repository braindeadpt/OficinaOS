import { describe, expect, it } from "vitest";
import {
  ImportFileError,
  MAX_FILE_BYTES,
  MAX_IMPORT_ROWS,
  mapRows,
  parseCsv,
  parsePtNumber,
  readTableFile,
  remapChunkErrors,
  xlsxUncompressedSize,
} from "../import-table";

describe("parseCsv — single detected delimiter", () => {
  it("detects ; from the header and ignores commas inside fields", () => {
    const rows = parseCsv("nome;preço;stock\nEcrã iPhone 11, original;12,50;3");
    expect(rows).toEqual([
      ["nome", "preço", "stock"],
      ["Ecrã iPhone 11, original", "12,50", "3"],
    ]);
  });

  it("detects , when the header is comma-delimited", () => {
    const rows = parseCsv('name,price\nScreen; Pro,10\n"A;B",5');
    expect(rows).toEqual([
      ["name", "price"],
      ["Screen; Pro", "10"],
      ["A;B", "5"],
    ]);
  });

  it("detects TAB when the header is tab-delimited", () => {
    const rows = parseCsv("name\tprice\nScreen\t10,5");
    expect(rows).toEqual([
      ["name", "price"],
      ["Screen", "10,5"],
    ]);
  });

  it("keeps quoted delimiters inside a cell", () => {
    const rows = parseCsv('nome;preco\n"Vidro; tampered";12,50');
    expect(rows[1]).toEqual(["Vidro; tampered", "12,50"]);
  });

  it("resolves a tie to ;", () => {
    // One ; and one , in the header — tie goes to ;
    const rows = parseCsv("a;b,c\n1;2,3");
    expect(rows[1]).toEqual(["1", "2,3"]);
  });
});

describe("parsePtNumber — Portuguese format", () => {
  it.each([
    ["12,50", 12.5],
    ["1.234,56", 1234.56],
    ["1.000", 1000],
    ["89.9", 89.9],
    ["42", 42],
    ["0,99", 0.99],
    ["-1,5", -1.5],
  ])("%s -> %s", (input, expected) => {
    expect(parsePtNumber(input)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "1.2.3.4,5",
    "12,34,56",
  ])("returns null for %j — never 0", (input) => {
    expect(parsePtNumber(input)).toBeNull();
  });

  it.each([
    ["12,50 €", 12.5],
    ["€12,50", 12.5],
    ["€ 1.234,56", 1234.56],
  ])("accepts the € symbol in %j", (input, expected) => {
    expect(parsePtNumber(input)).toBe(expected);
  });
});

describe("mapRows", () => {
  it("maps PT headers and converts numbers", () => {
    const out = mapRows("parts", [
      { nome: "Bateria", preço: "1.234,56", stock: "1.000" },
    ]);
    expect(out).toEqual([{ name: "Bateria", price: 1234.56, stock: 1000 }]);
  });

  it("keeps an unparseable number as a string so the server errors per row", () => {
    const out = mapRows("parts", [{ nome: "X", preço: "abc" }]);
    expect(out[0]?.price).toBe("abc");
  });

  it("drops empty cells (absent column ≠ 0)", () => {
    const out = mapRows("parts", [{ nome: "X", preço: "" }]);
    expect("price" in (out[0] ?? {})).toBe(false);
  });
});

describe("readTableFile", () => {
  const csvFile = (content: string | ArrayBuffer, name = "t.csv") =>
    new File([content], name);

  it("reads a UTF-8 CSV", async () => {
    const { rows } = await readTableFile(csvFile("nome;preço\nX;1,5"));
    expect(rows).toEqual([{ nome: "X", preço: "1,5" }]);
  });

  it("falls back to Windows-1252 when UTF-8 fails", async () => {
    // "preço" in cp1252: ç = 0xE7 — invalid UTF-8 sequence on its own.
    const raw = "nome;preço;stock\nBateria;12,50;3";
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      buf[i] = raw.charCodeAt(i); // raw is already latin-1 range
    }
    const { rows } = await readTableFile(csvFile(buf.buffer));
    expect(rows).toEqual([{ nome: "Bateria", preço: "12,50", stock: "3" }]);
  });

  it("rejects .xls with a clear error", async () => {
    await expect(readTableFile(csvFile("a;b", "old.xls"))).rejects.toThrow(
      ImportFileError
    );
    await expect(
      readTableFile(csvFile("a;b", "old.xls"))
    ).rejects.toMatchObject({ key: "data_io.xls_unsupported" });
  });

  it("rejects files over 10 MB", async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.csv");
    await expect(readTableFile(big)).rejects.toMatchObject({
      key: "data_io.file_too_large",
    });
  });

  it("rejects CSVs over the row limit", async () => {
    const header = "a;b\n";
    const row = "1;2\n";
    const content = header + row.repeat(MAX_IMPORT_ROWS + 1);
    await expect(readTableFile(csvFile(content))).rejects.toMatchObject({
      key: "data_io.too_many_rows",
    });
  });

  it("reads a real .xlsx", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const buf = await writeXlsxFile([
      [
        { value: "nome", type: String },
        { value: "preço", type: String },
      ],
      [
        { value: "Bateria", type: String },
        { value: 12.5, type: Number },
      ],
    ]).toBuffer();
    const { rows } = await readTableFile(
      new File([new Uint8Array(buf)], "t.xlsx")
    );
    expect(rows).toEqual([{ nome: "Bateria", preço: "12.5" }]);
  });

  it("tracks the physical file line of each row across blank lines", async () => {
    const { rows, lines } = await readTableFile(
      csvFile("nome\n\nEcrã\n\nBateria\n")
    );
    // header=1, blanks at 2 and 4 are skipped but still counted
    expect(rows).toEqual([{ nome: "Ecrã" }, { nome: "Bateria" }]);
    expect(lines).toEqual([3, 5]);
  });

  it("strips the export ' guard on formula-like cells (round-trip)", async () => {
    const { rows } = await readTableFile(
      csvFile("nome;fornecedor\n'=CMD();'+351911")
    );
    expect(rows).toEqual([{ fornecedor: "+351911", nome: "=CMD()" }]);
  });

  it("keeps a leading ' that is not an export guard", async () => {
    const { rows } = await readTableFile(csvFile("nome\n'd'Oliveira"));
    expect(rows).toEqual([{ nome: "'d'Oliveira" }]);
  });

  it("rejects an xlsx whose uncompressed size exceeds 50 MB", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const buf = new Uint8Array(
      await writeXlsxFile([[{ value: "a", type: String }]]).toBuffer()
    );
    // Patch the central directory's first entry to claim a huge
    // uncompressed size — simulates the zip-bomb advertising itself.
    const view = new DataView(buf.buffer);
    let patched = false;
    for (let i = 0; i < buf.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02_01_4b_50) {
        view.setUint32(i + 24, 60 * 1024 * 1024, true);
        patched = true;
        break;
      }
    }
    expect(patched).toBe(true);
    await expect(
      readTableFile(new File([buf], "bomb.xlsx"))
    ).rejects.toMatchObject({ key: "data_io.xlsx_too_large" });
  });
});

describe("remapChunkErrors — chunk-local row → file line", () => {
  it("reports the real file line for an error in a later chunk", () => {
    // 600 data rows: header is line 1, so file line = dataIndex + 2.
    // Chunk 2 covers data rows 501–600 → file lines 502–601.
    const allLines = Array.from({ length: 600 }, (_, i) => i + 2);
    const chunkLines = allLines.slice(500, 600);
    // Error on data row 550 → index 49 within chunk 2 → server reports 51.
    const errors = remapChunkErrors(
      [{ field: "price", message: "bad", row: 51 }],
      chunkLines
    );
    expect(errors[0]?.row).toBe(551);
  });

  it("accounts for blank lines the parser skipped", () => {
    // File: header(1), data(2), blank(3), data(4) — data row 2 is line 4.
    const errors = remapChunkErrors(
      [{ field: "", message: "bad", row: 3 }],
      [2, 4]
    );
    expect(errors[0]?.row).toBe(4);
  });

  it("keeps the server row when the line map is shorter", () => {
    const errors = remapChunkErrors(
      [{ field: "", message: "x", row: 9 }],
      [2, 3]
    );
    expect(errors[0]?.row).toBe(9);
  });
});

describe("xlsxUncompressedSize", () => {
  it("reads the declared uncompressed total from a real xlsx", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const buf = await writeXlsxFile([
      [{ value: "a", type: String }],
    ]).toBuffer();
    const size = xlsxUncompressedSize(new Uint8Array(buf).buffer);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(50 * 1024 * 1024);
  });
});
