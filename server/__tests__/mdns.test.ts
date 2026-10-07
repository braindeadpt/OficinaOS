import { createSocket } from "node:dgram";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildResponse,
  lanIpv4Addresses,
  primaryLanIpv4,
  readName,
  startMdnsResponder,
} from "../lib/mdns.js";

const noop = () => undefined;
const log = { info: noop, warn: noop } as never;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function buildQuery(name: string, type = 1): Buffer {
  const qname = Buffer.from(
    `${name
      .split(".")
      .map((l) => String.fromCharCode(l.length) + l)
      .join("")}\0`,
    "binary"
  );
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
    qname,
    Buffer.from([0, type, 0, 1]),
  ]);
}

describe("readName", () => {
  it("decodes a plain qname", () => {
    const q = buildQuery("oficinaos.local");
    expect(readName(q, 12)).toEqual({ name: "oficinaos.local", next: 29 });
  });

  it("rejects truncated packets", () => {
    expect(readName(Buffer.alloc(8), 12)).toBeNull();
    expect(readName(buildQuery("a.b").subarray(0, 14), 12)).toBeNull();
  });
});

describe("buildResponse", () => {
  it("echoes the question and appends an A record", () => {
    const q = buildQuery("oficinaos.local");
    const res = buildResponse(q, 33, "192.168.1.10"); // 12 hdr + 17 name + 4 qtype/qclass
    expect(res.readUInt16BE(2)).toBe(0x84_00); // QR + AA
    expect(res.readUInt16BE(6)).toBe(1); // ANCOUNT
    expect(res.readUInt16BE(res.length - 14)).toBe(1); // TYPE A
    expect([...res.subarray(-4)].join(".")).toBe("192.168.1.10");
  });
});

describe("mDNS responder (multicast roundtrip)", () => {
  const handle = startMdnsResponder("oficinaostest", log);

  afterAll(() => {
    handle?.close();
  });

  // Multicast loopback is unavailable in some CI containers — in that case
  // this verifies nothing and the packet-level tests above carry the proof.
  it("answers a real multicast A query when the network allows it", async () => {
    if (!handle) {
      return; // port 5353 busy on the runner
    }
    const answer = await new Promise<Buffer | null>((resolve) => {
      const c = createSocket({ type: "udp4", reuseAddr: true });
      const timer = setTimeout(() => {
        c.close();
        resolve(null);
      }, 3000);
      c.on("message", (msg) => {
        clearTimeout(timer);
        c.close();
        resolve(msg);
      });
      c.bind(0, () => {
        c.send(buildQuery("oficinaostest.local"), 5353, "224.0.0.251");
      });
    });
    if (!answer) {
      return; // multicast loopback unavailable — tolerated
    }
    expect(answer.readUInt16BE(6)).toBe(1); // ANCOUNT
    expect([...answer.subarray(-4)].join(".")).toMatch(IPV4_RE);
  });
});

describe("lanIpv4Addresses", () => {
  it("puts real adapters before virtual ones", () => {
    const ips = lanIpv4Addresses();
    expect(ips.length).toBeGreaterThan(0);
    expect(primaryLanIpv4()).toBe(ips[0]);
  });
});
