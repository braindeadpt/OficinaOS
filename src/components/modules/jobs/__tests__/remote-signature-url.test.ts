import { describe, expect, it } from "vitest";
import { pickSignBaseUrl } from "../intake-modal/remote-signature-url";

describe("pickSignBaseUrl", () => {
  // The signature QR must open on the customer's phone over the shop LAN.
  // Android resolves neither .local mDNS names nor bare machine hostnames —
  // preferring them produced a QR pointing at a page that never loaded.
  it("prefers a numeric LAN IPv4 over .local and machine hostnames", () => {
    expect(
      pickSignBaseUrl([
        "http://oficinaos.local:4000",
        "http://LOJA-PC:4000",
        "http://192.168.1.50:4000",
      ])
    ).toBe("http://192.168.1.50:4000");
  });

  it("keeps .local as the fallback when no IPv4 exists (iOS resolves it)", () => {
    expect(
      pickSignBaseUrl(["http://LOJA-PC:4000", "http://oficinaos.local:4000"])
    ).toBe("http://oficinaos.local:4000");
  });

  it("ignores malformed entries while scanning for an IPv4", () => {
    expect(pickSignBaseUrl(["not a url", "http://10.0.0.9:4000"])).toBe(
      "http://10.0.0.9:4000"
    );
  });

  it("falls back to the first URL and null on an empty list", () => {
    expect(pickSignBaseUrl(["http://LOJA-PC:4000"])).toBe(
      "http://LOJA-PC:4000"
    );
    expect(pickSignBaseUrl([])).toBeNull();
  });

  it("prefers a public HTTPS APP_URL over container IPs (Docker/demo)", () => {
    expect(
      pickSignBaseUrl([
        "https://demo.oficinaos.app",
        "http://3f2a1b:4000",
        "http://172.18.0.3:4000",
      ])
    ).toBe("https://demo.oficinaos.app");
  });

  it("never picks loopback, link-local or CGNAT addresses", () => {
    expect(
      pickSignBaseUrl([
        "http://127.0.0.1:4000",
        "http://169.254.10.2:4000",
        "http://100.101.102.103:4000",
        "http://192.168.1.50:4000",
      ])
    ).toBe("http://192.168.1.50:4000");
    expect(pickSignBaseUrl(["http://localhost:4000"])).toBeNull();
  });
});
