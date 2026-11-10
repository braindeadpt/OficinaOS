import { existsSync, readFileSync } from "node:fs";
import type os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessUrls,
  hasIsolatedNetNs,
  inContainerRuntime,
  isDialableUrl,
  lanIpv4Addresses,
  primaryLanIpv4,
} from "../lib/mdns.js";

// Deterministic coverage for container network detection: a bridge-netns
// container must suppress its own interface IPs, a host-network container
// must keep the host's real LAN adapters. Mocked fs+os so CI covers both.
vi.mock("node:fs", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:fs")>();
  return {
    ...mod,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(),
  };
});

const osMock = vi.hoisted(() => ({
  hostname: vi.fn(() => "pc-da-loja"),
  networkInterfaces: vi.fn(
    () => ({}) as ReturnType<typeof os.networkInterfaces>
  ),
}));

vi.mock("node:os", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:os")>();
  return {
    ...mod,
    default: { ...mod, ...osMock },
    hostname: osMock.hostname,
    networkInterfaces: osMock.networkInterfaces,
  };
});

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

function iface(address: string, internal = false): os.NetworkInterfaceInfo {
  return {
    address,
    cidr: `${address}/24`,
    family: "IPv4",
    internal,
    mac: "aa:bb:cc:dd:ee:ff",
    netmask: "255.255.255.0",
    scopeid: undefined as never,
  };
}

function env(opts: {
  container: boolean;
  hostname?: string;
  hosts?: string;
  interfaces?: Record<string, os.NetworkInterfaceInfo[]>;
}) {
  mockedExistsSync.mockImplementation(
    (p) => opts.container && String(p) === "/.dockerenv"
  );
  mockedReadFileSync.mockImplementation((p) => {
    if (String(p) === "/etc/hosts") {
      return opts.hosts ?? "";
    }
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  });
  osMock.hostname.mockReturnValue(opts.hostname ?? "3f2a1b9c8d");
  osMock.networkInterfaces.mockReturnValue(opts.interfaces ?? {});
}

const LO = { lo: [iface("127.0.0.1", true)] };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("inContainerRuntime", () => {
  it("is false outside containers and true with markers", () => {
    env({ container: false });
    expect(inContainerRuntime()).toBe(false);
    env({ container: true });
    expect(inContainerRuntime()).toBe(true);
    env({ container: false });
    vi.stubEnv("KUBERNETES_SERVICE_HOST", "10.96.0.1");
    expect(inContainerRuntime()).toBe(true);
  });
});

describe("hasIsolatedNetNs / lanIpv4Addresses", () => {
  it("keeps real adapters on a bare host (real before virtual)", () => {
    env({
      container: false,
      interfaces: {
        "vEthernet (WSL)": [iface("172.20.0.1")],
        Ethernet: [iface("192.168.1.10")],
        ...LO,
      },
    });
    expect(hasIsolatedNetNs()).toBe(false);
    expect(lanIpv4Addresses()).toEqual(["192.168.1.10", "172.20.0.1"]);
    expect(primaryLanIpv4()).toBe("192.168.1.10");
  });

  it("suppresses interface IPs in a bridge-netns container", () => {
    // Docker writes "<containerIP> <hostname>" in /etc/hosts — the tell of
    // an isolated netns. That IP is unreachable from the LAN: emit nothing.
    env({
      container: true,
      hosts: "127.0.0.1 localhost\n172.18.0.5 3f2a1b9c8d\n",
      interfaces: { ...LO, eth0: [iface("172.18.0.5")] },
    });
    expect(hasIsolatedNetNs()).toBe(true);
    expect(lanIpv4Addresses()).toEqual([]);
    expect(primaryLanIpv4()).toBeNull();
  });

  it("keeps the host LAN adapters in a host-network container", () => {
    // --network host: hostname maps to loopback, interfaces are the host's.
    env({
      container: true,
      hosts: "127.0.0.1 localhost\n127.0.1.1 3f2a1b9c8d\n",
      interfaces: { ...LO, eth0: [iface("192.168.1.20")] },
    });
    expect(hasIsolatedNetNs()).toBe(false);
    expect(lanIpv4Addresses()).toEqual(["192.168.1.20"]);
    expect(primaryLanIpv4()).toBe("192.168.1.20");
  });

  it("treats a K8s pod netns as isolated", () => {
    vi.stubEnv("KUBERNETES_SERVICE_HOST", "10.96.0.1");
    env({
      container: false, // no /.dockerenv — detected via the env var
      hosts: "127.0.0.1 localhost\n10.244.1.7 pod-7f9c\n",
      hostname: "pod-7f9c",
      interfaces: { ...LO, eth0: [iface("10.244.1.7")] },
    });
    expect(hasIsolatedNetNs()).toBe(true);
    expect(lanIpv4Addresses()).toEqual([]);
  });

  it("keeps interfaces when the hostname is absent from /etc/hosts", () => {
    // Custom bind-mounted hosts file — can't prove isolation, so the
    // interfaces might be the host's: keep them rather than go silent.
    env({
      container: true,
      hosts: "127.0.0.1 localhost\n",
      interfaces: { ...LO, eth0: [iface("192.168.1.20")] },
    });
    expect(hasIsolatedNetNs()).toBe(false);
    expect(lanIpv4Addresses()).toEqual(["192.168.1.20"]);
  });
});

describe("isDialableUrl", () => {
  it("rejects loopback and wildcard hosts — phones can never open them", () => {
    for (const url of [
      "http://localhost:4000",
      "http://x.localhost:4000",
      "http://127.0.0.1:4000",
      "http://[::1]:4000",
      "http://0.0.0.0:4000",
      "http://[::]:4000",
      "not a url",
    ]) {
      expect(isDialableUrl(url)).toBe(false);
    }
    for (const url of [
      "https://loja.example.com",
      "http://192.168.1.20:4000",
      "http://pc-da-loja:4000",
    ]) {
      expect(isDialableUrl(url)).toBe(true);
    }
  });
});

describe("accessUrls", () => {
  const HOST_IFACES = { ...LO, eth0: [iface("192.168.1.20")] };

  it("emits every reachable form on a bare host", () => {
    env({
      container: false,
      hostname: "pc-da-loja",
      interfaces: HOST_IFACES,
    });
    const out = accessUrls({
      appUrl: "http://localhost:4000", // dev default — never dialable
      mdnsHostname: "oficinaos",
      port: 4000,
    });
    expect(out.needsAppUrl).toBe(false);
    expect(out.urls).toEqual([
      "http://oficinaos.local:4000",
      "http://pc-da-loja:4000",
      "http://192.168.1.20:4000",
    ]);
  });

  it("keeps only a usable APP_URL in a bridge-netns container", () => {
    env({
      container: true,
      hosts: "127.0.0.1 localhost\n172.18.0.5 3f2a1b9c8d\n",
      interfaces: { ...LO, eth0: [iface("172.18.0.5")] },
    });
    // The container hostname (3f2a1b9c8d), the .local name and the bridge IP
    // are all unreachable — emitting them just feeds a dead QR.
    const out = accessUrls({
      appUrl: "https://loja.example.com",
      mdnsHostname: "oficinaos",
      port: 4000,
    });
    expect(out).toEqual({
      urls: ["https://loja.example.com"],
      needsAppUrl: false,
    });
  });

  it("asks for APP_URL when an isolated container has no usable URL", () => {
    env({
      container: true,
      hosts: "127.0.0.1 localhost\n172.18.0.5 3f2a1b9c8d\n",
      interfaces: { ...LO, eth0: [iface("172.18.0.5")] },
    });
    for (const appUrl of [
      undefined,
      "http://localhost:4000",
      "http://0.0.0.0:4000",
    ]) {
      expect(
        accessUrls({ appUrl, mdnsHostname: "oficinaos", port: 4000 })
      ).toEqual({
        urls: [],
        needsAppUrl: true,
      });
    }
  });

  it("keeps the real hostname under host networking", () => {
    env({
      container: true,
      hostname: "pc-da-loja",
      hosts: "127.0.0.1 localhost\n127.0.1.1 pc-da-loja\n",
      interfaces: HOST_IFACES,
    });
    const out = accessUrls({ port: 4000 });
    expect(out.needsAppUrl).toBe(false);
    expect(out.urls).toEqual([
      "http://pc-da-loja:4000",
      "http://192.168.1.20:4000",
    ]);
  });
});
