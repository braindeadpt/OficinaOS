import { createServer } from "node:net";
import type { ShopSettings } from "@generated/client";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import {
  buildJobReceiptEscPos,
  buildSaleReceiptEscPos,
  buildTestTicketEscPos,
  sendEscPos,
  sendToPrinter,
} from "../escpos.service";

const ESC = 0x1b;
const GS = 0x1d;

const SETTINGS = {
  currency: "EUR",
  defaultWarrantyDays: 30,
  labelSize: "40x20",
  printerHost: "127.0.0.1",
  printerMode: "escpos",
  printerPort: 9100,
  receiptFooter: null,
  receiptPaper: "80mm",
  receiptShowImei: true,
  receiptShowProblem: true,
  receiptShowQr: true,
  receiptShowSignature: true,
  receiptShowWarranty: true,
  shopName: "Oficina São João",
  trackingBaseUrl: null,
} as unknown as ShopSettings;

const JOB = {
  createdAt: new Date("2026-10-09T10:00:00Z"),
  customer: { name: "João António", phone: "912345678" },
  device: { brand: { name: "Apple" }, model: "iPhone 15" },
  estimatedCost: 80,
  id: "job1",
  imei: "123456789012345",
  jobCode: "O-2026-001",
  partsUsed: [],
  payments: [],
  repairs: [{ repairName: "Ecrã", price: 80, repair: null }],
  reportedProblem: "Ecrã partido — não liga",
};

const SALE = {
  createdAt: new Date("2026-10-09T10:00:00Z"),
  createdBy: { name: "Maria" },
  customer: { name: "Cliente", phone: "910000000" },
  items: [{ lineTotal: 20, name: "Película vidro", quantity: 2 }],
  payments: [{ amount: 20, method: "CASH", reference: null }],
  saleCode: "V-2026-001",
  total: 20,
};

const decode = (buf: Buffer) => iconv.decode(buf, "cp850");
const DASHES_RE = /^-+$/;

describe("buildJobReceiptEscPos", () => {
  it("starts with init+codepage and ends with feed+cut", () => {
    const buf = buildJobReceiptEscPos(SETTINGS, JOB, "https://app.test");
    expect(buf[0]).toBe(ESC);
    expect(buf[1]).toBe(0x40);
    expect(buf.subarray(-4)).toEqual(Buffer.from([GS, 0x56, 0x41, 0x03]));
  });

  it("contains job data and respects section toggles", () => {
    const buf = buildJobReceiptEscPos(SETTINGS, JOB, "https://app.test");
    const text = decode(buf);
    expect(text).toContain("O-2026-001");
    expect(text).toContain("123456789012345");
    expect(text).toContain("80 EUR");

    const noImei = buildJobReceiptEscPos(
      { ...SETTINGS, receiptShowImei: false },
      JOB,
      "https://app.test"
    );
    expect(decode(noImei)).not.toContain("123456789012345");

    const noProblem = buildJobReceiptEscPos(
      { ...SETTINGS, receiptShowProblem: false },
      JOB,
      "https://app.test"
    );
    expect(decode(noProblem)).not.toContain("Ecrã partido");
  });

  it("hides cost lines when hideCosts is set", () => {
    const buf = buildJobReceiptEscPos(SETTINGS, JOB, "https://app.test", {
      hideCosts: true,
    });
    expect(decode(buf)).not.toContain("80 EUR");
  });

  it("emits the native QR command when tracking URL exists", () => {
    const buf = buildJobReceiptEscPos(SETTINGS, JOB, "https://app.test");
    const qrCmd = Buffer.from([GS, 0x28, 0x6b]);
    expect(buf.includes(qrCmd)).toBe(true);

    const noQr = buildJobReceiptEscPos(
      { ...SETTINGS, receiptShowQr: false },
      JOB,
      "https://app.test"
    );
    expect(noQr.includes(qrCmd)).toBe(false);
  });

  it("uses 32-col width for 58mm paper", () => {
    const buf = buildJobReceiptEscPos(
      { ...SETTINGS, receiptPaper: "58mm" },
      JOB,
      "https://app.test"
    );
    const lines = decode(buf)
      .split("\n")
      .filter((l) => DASHES_RE.test(l.trim()));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].trim().length).toBe(32);
  });
});

describe("buildSaleReceiptEscPos", () => {
  it("contains sale code, items and total", () => {
    const buf = buildSaleReceiptEscPos(SETTINGS, SALE);
    const text = decode(buf);
    expect(text).toContain("V-2026-001");
    expect(text).toContain("Película vidro x2");
    expect(text).toContain("20 EUR");
  });
});

describe("buildTestTicketEscPos", () => {
  it("contains the test marker and shop name", () => {
    const buf = buildTestTicketEscPos(SETTINGS);
    const text = decode(buf);
    expect(text).toContain("PRINT TEST OK");
    expect(text).toContain("Oficina São João");
  });
});

describe("sendEscPos", () => {
  it("rejects when the printer is not configured", async () => {
    await expect(
      sendEscPos({ ...SETTINGS, printerMode: "browser" }, Buffer.alloc(1))
    ).rejects.toMatchObject({ code: "PRINTER_NOT_CONFIGURED" });
    await expect(
      sendEscPos({ ...SETTINGS, printerHost: null }, Buffer.alloc(1))
    ).rejects.toMatchObject({ code: "PRINTER_NOT_CONFIGURED" });
  });
});

describe("sendToPrinter", () => {
  it("delivers bytes to a TCP listener", async () => {
    const payload = Buffer.from("hello printer");
    const received = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const server = createServer((socket) => {
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.on("end", () => {
          server.close();
          resolve(Buffer.concat(chunks));
        });
        socket.on("error", reject);
      });
      server.listen(0, "127.0.0.1", async () => {
        const port = (server.address() as { port: number }).port;
        try {
          await sendToPrinter("127.0.0.1", port, payload);
        } catch (err) {
          server.close();
          reject(err);
        }
      });
    });
    expect(received.toString()).toBe("hello printer");
  });

  it("rejects on connection refused", async () => {
    await expect(
      sendToPrinter("127.0.0.1", 1, Buffer.alloc(1), 2000)
    ).rejects.toThrow();
  });

  it("rejects an invalid host without touching the network", async () => {
    await expect(
      sendToPrinter("bad;host", 9100, Buffer.alloc(1), 500)
    ).rejects.toThrow("Invalid printer host");
  });
});
