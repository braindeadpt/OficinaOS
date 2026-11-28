import { describe, expect, it, vi } from "vitest";
import { bootstrapPontoHosted } from "../../scripts/bootstrap-ponto-hosted";

function jsonResponse(
  body: unknown,
  status = 200,
  cookies: string[] = []
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(JSON.stringify(body), { headers, status });
}

function options() {
  return {
    cloudApiUrl: "https://cloud.example",
    hostedSlug: "empresa-teste",
    ownerLogin: "dono@example.com",
    ownerName: "Dono",
    ownerPassword: "palavra-passe-forte",
    pairingCode: "ABCD-1234",
    setupToken: "setup-token-123456",
    shopMode: "ponto_only" as const,
    shopName: "Empresa Teste",
  };
}

describe("bootstrapPontoHosted", () => {
  it("cria o proprietário e emparelha uma instância nova", async () => {
    const calls: Array<{ body?: string; method: string; url: string }> = [];
    let cloudPaired = false;
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        await Promise.resolve();
        const url = String(input);
        const body = typeof init?.body === "string" ? init.body : undefined;
        calls.push({ body, method: init?.method ?? "GET", url });
        if (url.endsWith("/api/csrf-token")) {
          return jsonResponse({ token: "csrf" }, 200, [
            "csrf-cookie=abc; Path=/",
          ]);
        }
        if (url.includes("/api/setup/status")) {
          return jsonResponse({ allowed: true, needsSetup: true });
        }
        if (url.endsWith("/api/setup")) {
          return jsonResponse({ email: "dono@example.com" }, 201);
        }
        if (url.endsWith("/api/auth/sign-in/email")) {
          return jsonResponse({ ok: true }, 200, ["session=xyz; Path=/"]);
        }
        if (url.endsWith("/api/settings/shop")) {
          return jsonResponse({ shopMode: "ponto_only" });
        }
        if (url.endsWith("/api/settings/cloud/pair")) {
          cloudPaired = true;
          return jsonResponse({ paired: true });
        }
        if (url.endsWith("/api/settings/cloud")) {
          return jsonResponse({ paired: cloudPaired });
        }
        throw new Error(url);
      }
    );

    const result = await bootstrapPontoHosted(
      options(),
      fetchImpl as typeof fetch
    );

    expect(result).toEqual({
      ownerCreated: true,
      paired: true,
      pairingSkipped: false,
    });
    const setupCall = calls.find((call) => call.url.endsWith("/api/setup"));
    expect(JSON.parse(setupCall?.body ?? "{}")).toMatchObject({
      login: "dono@example.com",
      shopMode: "ponto_only",
      shopName: "Empresa Teste",
    });
    const pairCall = calls.find((call) =>
      call.url.endsWith("/api/settings/cloud/pair")
    );
    expect(JSON.parse(pairCall?.body ?? "{}")).toEqual({
      apiUrl: "https://cloud.example",
      code: "ABCD-1234",
      hostedSlug: "empresa-teste",
    });
  });

  it("numa segunda execução não volta a consumir o código de emparelhamento", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        await Promise.resolve();
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/api/csrf-token")) {
          return jsonResponse({ token: "csrf" });
        }
        if (url.includes("/api/setup/status")) {
          return jsonResponse({ allowed: false, needsSetup: false });
        }
        if (url.endsWith("/api/auth/sign-in/email")) {
          return jsonResponse({ ok: true }, 200, ["session=xyz; Path=/"]);
        }
        if (url.endsWith("/api/settings/shop")) {
          return jsonResponse({ shopMode: "ponto_only" });
        }
        if (url.endsWith("/api/settings/cloud")) {
          return jsonResponse({ paired: true });
        }
        throw new Error(`${init?.method ?? "GET"} ${url}`);
      }
    );

    const result = await bootstrapPontoHosted(
      options(),
      fetchImpl as typeof fetch
    );

    expect(result).toEqual({
      ownerCreated: false,
      paired: true,
      pairingSkipped: true,
    });
    expect(urls.some((url) => url.endsWith("/api/setup"))).toBe(false);
    expect(urls.some((url) => url.endsWith("/api/settings/cloud/pair"))).toBe(
      false
    );
  });

  it("corrige o modo antes de qualquer emparelhamento Cloud", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    let shopReads = 0;
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        await Promise.resolve();
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ method, url });
        if (url.endsWith("/api/csrf-token")) {
          return jsonResponse({ token: "csrf" });
        }
        if (url.includes("/api/setup/status")) {
          return jsonResponse({ allowed: false, needsSetup: false });
        }
        if (url.endsWith("/api/auth/sign-in/email")) {
          return jsonResponse({ ok: true });
        }
        if (url.endsWith("/api/settings/shop") && method === "PUT") {
          return jsonResponse({ ok: true });
        }
        if (url.endsWith("/api/settings/shop")) {
          shopReads += 1;
          return jsonResponse({
            shopMode: shopReads === 1 ? "repair_shop" : "ponto_only",
          });
        }
        if (url.endsWith("/api/settings/cloud")) {
          return jsonResponse({ paired: true });
        }
        throw new Error(`${method} ${url}`);
      }
    );

    const result = await bootstrapPontoHosted(
      options(),
      fetchImpl as typeof fetch
    );

    expect(result.pairingSkipped).toBe(true);
    const putIndex = calls.findIndex(
      (c) => c.method === "PUT" && c.url.endsWith("/api/settings/shop")
    );
    const cloudIndex = calls.findIndex((c) =>
      c.url.endsWith("/api/settings/cloud")
    );
    expect(putIndex).toBeGreaterThanOrEqual(0);
    expect(cloudIndex).toBeGreaterThan(putIndex);
  });

  it("recusa emparelhar quando a imagem não aplica o modo só-ponto", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        await Promise.resolve();
        const url = String(input);
        urls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/api/csrf-token")) {
          return jsonResponse({ token: "csrf" });
        }
        if (url.includes("/api/setup/status")) {
          return jsonResponse({ allowed: false, needsSetup: false });
        }
        if (url.endsWith("/api/auth/sign-in/email")) {
          return jsonResponse({ ok: true });
        }
        if (url.endsWith("/api/settings/shop") && init?.method === "PUT") {
          return jsonResponse({ ok: true });
        }
        if (url.endsWith("/api/settings/shop")) {
          return jsonResponse({ shopMode: "repair_shop" });
        }
        throw new Error(url);
      }
    );

    await expect(
      bootstrapPontoHosted(options(), fetchImpl as typeof fetch)
    ).rejects.toThrow("não aplicou shopMode=ponto_only");
    expect(urls.some((u) => u.includes("/api/settings/cloud"))).toBe(false);
  });

  it("falha com erro claro quando o login do proprietário é recusado", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      const url = String(input);
      if (url.endsWith("/api/csrf-token")) {
        return jsonResponse({ token: "csrf" });
      }
      if (url.includes("/api/setup/status")) {
        return jsonResponse({ allowed: false, needsSetup: false });
      }
      if (url.endsWith("/api/auth/sign-in/email")) {
        return jsonResponse({ message: "credenciais inválidas" }, 401);
      }
      throw new Error(url);
    });

    await expect(
      bootstrapPontoHosted(options(), fetchImpl as typeof fetch)
    ).rejects.toThrow("login do proprietário falhou: credenciais inválidas");
  });
});
