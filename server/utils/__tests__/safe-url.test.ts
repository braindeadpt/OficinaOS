import { beforeEach, describe, expect, it, vi } from "vitest";

// Guarda SSRF do download de foto do livro de ponto: só https público
// (ou a origem Evolution configurada), DNS resolvido sem IPs privados,
// redirects revalidados e corpo com limite.

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));

import { fetchPublicMedia, isPrivateIpLiteral } from "../safe-url.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const PUBLIC_IP = "93.184.216.34";

function publicLookup() {
  mocks.lookup.mockResolvedValue([{ address: PUBLIC_IP }]);
}

function okResponse(body = "img", contentType = "image/png") {
  return Promise.resolve(
    new Response(body, { headers: { "content-type": contentType } })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  publicLookup();
});

describe("isPrivateIpLiteral", () => {
  const cases: [string, boolean][] = [
    ["127.0.0.1", true],
    ["10.0.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["169.254.169.254", true], // metadata cloud
    ["100.64.0.1", true], // CGNAT
    ["0.0.0.0", true],
    ["224.0.0.1", true], // multicast
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["::1", true],
    ["::", true],
    ["fe80::1", true], // link-local
    ["fd00::1", true], // ULA
    ["fc00::1", true],
    ["ff02::1", true], // multicast
    ["::ffff:127.0.0.1", true], // IPv4-mapped loopback
    ["::ffff:8.8.8.8", false], // IPv4-mapped público
    ["64:ff9b::7f00:1", true], // NAT64 WKP → 127.0.0.1
    ["64:ff9b::808:808", false], // NAT64 WKP → 8.8.8.8
    ["64:ff9b:1:2:3:4:808:808", true], // fora do /96 → bloqueia
    ["2002:a00:1::", true], // 6to4
    ["2001::1", true], // Teredo
    ["2001:4860:4860::8888", false], // Google DNS — não é Teredo
    ["2606:4700:4700::1111", false], // Cloudflare DNS público
    ["example.com", false], // não é IP literal
  ];
  for (const [host, expected] of cases) {
    it(`${host} → ${expected}`, () => {
      expect(isPrivateIpLiteral(host)).toBe(expected);
    });
  }
});

describe("fetchPublicMedia — rejeições", () => {
  it("esquemas não-http(s) → null sem fetch", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "javascript:alert(1)",
      "data:image/png;base64,xx",
    ]) {
      expect(await fetchPublicMedia(url)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("http fora da origem confiável → null", async () => {
    expect(await fetchPublicMedia("http://example.com/x.jpg")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("IP literal privado/link-local → null sem DNS nem fetch", async () => {
    for (const url of [
      "https://127.0.0.1/x.jpg",
      "https://10.1.2.3/x.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://192.168.0.1/x.jpg",
      "https://[::1]/x.jpg",
      "https://[fd00::1]/x.jpg",
    ]) {
      expect(await fetchPublicMedia(url)).toBeNull();
    }
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hostnames locais/bloqueados → null", async () => {
    for (const url of [
      "https://localhost/x.jpg",
      "https://metadata.google.internal/computeMetadata",
      "https://router.lan/x.jpg",
      "https://foo.local/x.jpg",
    ]) {
      expect(await fetchPublicMedia(url)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DNS que resolve para IP privado → null", async () => {
    mocks.lookup.mockResolvedValue([{ address: "10.1.2.3" }]);
    expect(await fetchPublicMedia("https://evil.example.com/x.jpg")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DNS misto (público+privado) → null — um privado chega", async () => {
    mocks.lookup.mockResolvedValue([
      { address: PUBLIC_IP },
      { address: "192.168.1.1" },
    ]);
    expect(
      await fetchPublicMedia("https://mixed.example.com/x.jpg")
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("DNS falha → null (não há como provar que é público)", async () => {
    mocks.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await fetchPublicMedia("https://nope.example.com/x.jpg")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirect para IP privado → null (cada salto é revalidado)", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(Response.redirect("https://169.254.169.254/latest", 302))
    );
    expect(await fetchPublicMedia("https://example.com/x.jpg")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirect para http fora da origem → null", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(Response.redirect("http://example.com/plain.jpg", 301))
    );
    expect(await fetchPublicMedia("https://example.com/x.jpg")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("content-length declarado acima do limite → null sem ler o corpo", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        body: null,
        headers: new Headers({ "content-length": "99999999" }),
        ok: true,
        status: 200,
      } as Response)
    );
    expect(
      await fetchPublicMedia("https://example.com/big.jpg", {
        maxBytes: 1024,
      })
    ).toBeNull();
  });

  it("corpo acima do limite → null", async () => {
    fetchMock.mockReturnValueOnce(okResponse("x".repeat(2048), "image/png"));
    expect(
      await fetchPublicMedia("https://example.com/big.jpg", {
        maxBytes: 1024,
      })
    ).toBeNull();
  });

  it("resposta não-OK → null", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve(new Response("nf", { status: 404 }))
    );
    expect(
      await fetchPublicMedia("https://example.com/missing.jpg")
    ).toBeNull();
  });
});

describe("fetchPublicMedia — caminhos permitidos", () => {
  it("https público com DNS público → buffer + content-type", async () => {
    fetchMock.mockReturnValueOnce(okResponse("imgdata", "image/jpeg"));
    const res = await fetchPublicMedia("https://cdn.example.com/f.jpg");
    expect(res?.buffer.toString()).toBe("imgdata");
    expect(res?.contentType).toBe("image/jpeg");
    expect(mocks.lookup).toHaveBeenCalledWith("cdn.example.com", {
      all: true,
      verbatim: true,
    });
  });

  it("origem confiável (Evolution LAN) → http permitido sem DNS", async () => {
    fetchMock.mockReturnValueOnce(okResponse("img", "image/png"));
    const res = await fetchPublicMedia("http://evo.lan:8080/media/abc", {
      trustedOrigin: "http://evo.lan:8080",
    });
    expect(res?.buffer.toString()).toBe("img");
    // Mesma origem → não precisa de lookup.
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("origem confiável não isenta outros hosts", async () => {
    expect(
      await fetchPublicMedia("http://outro.lan/x.jpg", {
        trustedOrigin: "http://evo.lan:8080",
      })
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redirect https→https público → segue e devolve", async () => {
    fetchMock
      .mockReturnValueOnce(
        Promise.resolve(
          Response.redirect("https://cdn2.example.com/f.jpg", 302)
        )
      )
      .mockReturnValueOnce(okResponse("final", "image/png"));
    const res = await fetchPublicMedia("https://example.com/f.jpg");
    expect(res?.buffer.toString()).toBe("final");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
