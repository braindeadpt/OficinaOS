import { describe, expect, it } from "vitest";
import {
  ipv4Octets,
  ipv6Hextets,
  isPublicIpv4Octets,
  isPublicIpv6,
} from "../ip-address";

describe("ipv4Octets", () => {
  it("parses a dotted quad", () => {
    expect(ipv4Octets("192.168.1.20")).toEqual([192, 168, 1, 20]);
  });

  it("rejects non-IPv4 hosts and out-of-range octets", () => {
    expect(ipv4Octets("example.com")).toBeNull();
    expect(ipv4Octets("[::1]")).toBeNull();
    expect(ipv4Octets("999.1.1.1")).toBeNull();
  });
});

describe("isPublicIpv4Octets", () => {
  it("accepts public addresses", () => {
    expect(isPublicIpv4Octets([8, 8, 8, 8])).toBe(true);
    expect(isPublicIpv4Octets([203, 0, 113, 7])).toBe(true);
  });

  it.each([
    [0, 0, 0, 0],
    [10, 0, 0, 1],
    [127, 0, 0, 1],
    [169, 254, 0, 1],
    [172, 16, 0, 1],
    [172, 31, 255, 255],
    [192, 168, 1, 1],
    [100, 64, 0, 1],
    [100, 127, 255, 255],
  ])("rejects the non-public range %j", (...octets) => {
    expect(isPublicIpv4Octets(octets)).toBe(false);
  });
});

describe("ipv6Hextets", () => {
  it("expands a full literal", () => {
    expect(ipv6Hextets("[2606:4700:4700::1111]")).toHaveLength(8);
    expect(ipv6Hextets("[2001:4860:4860:0:0:0:0:8888]")).toEqual([
      0x20_01, 0x48_60, 0x48_60, 0, 0, 0, 0, 0x88_88,
    ]);
  });

  it("handles an embedded dotted-quad tail", () => {
    expect(ipv6Hextets("[::ffff:192.0.2.1]")).toEqual([
      0, 0, 0, 0, 0, 0xff_ff, 0xc0_00, 0x02_01,
    ]);
  });

  it("rejects non-literals and malformed input", () => {
    expect(ipv6Hextets("example.com")).toBeNull();
    expect(ipv6Hextets("2606:4700::1111")).toBeNull(); // no brackets
    expect(ipv6Hextets("[:::]")).toBeNull();
    expect(ipv6Hextets("[gggg::1]")).toBeNull();
    expect(ipv6Hextets("[1:2:3:4:5:6:7:8:9]")).toBeNull();
  });
});

describe("isPublicIpv6", () => {
  it.each([
    "[2606:4700:4700::1111]",
    "[2001:4860:4860::8888]",
    "[::ffff:8.8.8.8]",
  ])("accepts the globally routable literal %s", (host) => {
    expect(isPublicIpv6(host)).toBe(true);
  });

  it.each([
    "[::]", // unspecified
    "[::1]", // loopback
    "[fe80::1]", // link-local
    "[febf::1]", // link-local range edge
    "[fc00::1]", // unique-local
    "[fd12:3456::1]", // unique-local
    "[fec0::1]", // site-local (deprecated)
    "[ff02::1]", // multicast
    "[::ffff:10.0.0.1]", // mapped private
    "[::ffff:192.168.1.1]", // mapped private
    "[::ffff:127.0.0.1]", // mapped loopback
    "[::ffff:100.64.0.1]", // mapped CGNAT
    "[::10.0.0.1]", // compatible private
    "not-an-ip",
    "example.com",
  ])("rejects %s", (host) => {
    expect(isPublicIpv6(host)).toBe(false);
  });
});
