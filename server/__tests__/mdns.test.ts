import { createSocket } from "node:dgram";
import type os from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildResponse,
  hasIsolatedNetNs,
  isolatedNetNsFromHosts,
  lanIpv4Addresses,
  pickLanIpv4s,
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
    if (hasIsolatedNetNs()) {
      // Isolated-netns container interface IPs are unreachable from the
      // shop LAN — never offered: the QR picker would emit a dead 172.x
      // URL. APP_URL is the only honest base there.
      expect(ips).toEqual([]);
      expect(primaryLanIpv4()).toBeNull();
      return;
    }
    expect(ips.length).toBeGreaterThan(0);
    expect(primaryLanIpv4()).toBe(ips[0]);
  });
});

// Os dois modos de rede de um contentor testam-se em separado: bridge
// (netns isolado) tem de esconder os IPs das interfaces — são 172.x
// inatingíveis — enquanto --network host partilha o namespace do host e
// os adaptadores físicos continuam alcançáveis (e é o único modo onde o
// multicast mDNS funciona).
describe("container network modes", () => {
  const eth0 = (address: string) =>
    ({
      address,
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "02:42:ac:12:00:05",
      internal: false,
      cidr: `${address}/24`,
    }) as os.NetworkInterfaceInfo;

  it("bridge: hostname mapeado para o próprio IP do contentor → nenhum LAN ip", () => {
    const isolated = isolatedNetNsFromHosts({
      hostname: "c3f2a1b9",
      ifaceIps: new Set(["172.18.0.5"]),
      hostsContent: "127.0.0.1 localhost\n172.18.0.5 c3f2a1b9\n",
    });
    expect(isolated).toBe(true);
    expect(pickLanIpv4s({ eth0: [eth0("172.18.0.5")] }, isolated)).toEqual([]);
  });

  it("host network: hostname em loopback → adaptadores físicos mantidos", () => {
    const isolated = isolatedNetNsFromHosts({
      hostname: "oficina-pc",
      ifaceIps: new Set(["192.168.1.20"]),
      hostsContent: "127.0.0.1 localhost\n127.0.1.1 oficina-pc\n",
    });
    expect(isolated).toBe(false);
    expect(
      pickLanIpv4s(
        { eth0: [eth0("192.168.1.20")], docker0: [eth0("172.17.0.1")] },
        isolated
      )
    ).toEqual(["192.168.1.20", "172.17.0.1"]);
  });

  it("hostname sem entrada em /etc/hosts → não prova isolamento", () => {
    expect(
      isolatedNetNsFromHosts({
        hostname: "ausente",
        ifaceIps: new Set(["192.168.1.20"]),
        hostsContent: "127.0.0.1 localhost\n",
      })
    ).toBe(false);
  });
});
