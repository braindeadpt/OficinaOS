interface ApiResult {
  body: unknown;
  ok: boolean;
  status: number;
}

type FetchLike = typeof fetch;

const SET_COOKIE_SPLIT = /,(?=[^;,=]+=)/;

export interface PontoHostedBootstrapOptions {
  baseUrl?: string;
  cloudApiUrl: string;
  ownerLogin: string;
  ownerName: string;
  ownerPassword: string;
  pairingCode?: string;
  setupToken: string;
  shopMode: "ponto_only" | "repair_shop";
  shopName: string;
}

export interface PontoHostedBootstrapResult {
  ownerCreated: boolean;
  paired: boolean;
  pairingSkipped: boolean;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: unknown; message?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
    if (typeof error === "object" && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return fallback;
}

function setCookies(headers: Headers): string[] {
  const withList = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withList.getSetCookie === "function") {
    return withList.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? combined.split(SET_COOKIE_SPLIT) : [];
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  capture(headers: Headers): void {
    for (const cookie of setCookies(headers)) {
      const first = cookie.split(";", 1)[0] ?? "";
      const separator = first.indexOf("=");
      if (separator > 0) {
        this.cookies.set(
          first.slice(0, separator).trim(),
          first.slice(separator + 1).trim()
        );
      }
    }
  }

  header(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

async function readBody(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export async function bootstrapPontoHosted(
  options: PontoHostedBootstrapOptions,
  fetchImpl: FetchLike = fetch
): Promise<PontoHostedBootstrapResult> {
  const baseUrl = (options.baseUrl ?? "http://127.0.0.1:4000").replace(
    /\/+$/,
    ""
  );
  const jar = new CookieJar();
  let csrfToken: string | undefined;

  async function api(
    path: string,
    init: { body?: unknown; method?: string } = {}
  ): Promise<ApiResult> {
    const headers: Record<string, string> = {};
    const cookie = jar.header();
    if (cookie) {
      headers.cookie = cookie;
    }
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (csrfToken && init.method && init.method !== "GET") {
      headers["x-csrf-token"] = csrfToken;
    }
    const res = await fetchImpl(`${baseUrl}${path}`, {
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers,
      method: init.method ?? "GET",
    });
    jar.capture(res.headers);
    return { body: await readBody(res), ok: res.ok, status: res.status };
  }

  async function refreshCsrf(): Promise<void> {
    const res = await api("/api/csrf-token");
    const token = (res.body as { token?: unknown } | null)?.token;
    if (!(res.ok && typeof token === "string")) {
      throw new Error("não foi possível obter o token CSRF da instância");
    }
    csrfToken = token;
  }

  await refreshCsrf();

  const setupStatus = await api(
    `/api/setup/status?token=${encodeURIComponent(options.setupToken)}`
  );
  const setup = setupStatus.body as {
    allowed?: boolean;
    needsSetup?: boolean;
  } | null;
  let ownerCreated = false;

  if (setup?.needsSetup === true) {
    if (setup.allowed !== true) {
      throw new Error("o primeiro arranque recusou o SETUP_TOKEN gerado");
    }
    const created = await api("/api/setup", {
      body: {
        confirmPassword: options.ownerPassword,
        login: options.ownerLogin,
        name: options.ownerName,
        password: options.ownerPassword,
        shopMode: options.shopMode,
        shopName: options.shopName,
        token: options.setupToken,
      },
      method: "POST",
    });
    if (!created.ok) {
      throw new Error(
        `criação do proprietário falhou: ${errorMessage(created.body, `HTTP ${created.status}`)}`
      );
    }
    ownerCreated = true;
  }

  const signInPath = options.ownerLogin.includes("@")
    ? "/api/auth/sign-in/email"
    : "/api/auth/sign-in/username";
  const signInBody = options.ownerLogin.includes("@")
    ? {
        email: options.ownerLogin,
        password: options.ownerPassword,
        rememberMe: true,
      }
    : {
        password: options.ownerPassword,
        rememberMe: true,
        username: options.ownerLogin,
      };
  const signIn = await api(signInPath, { body: signInBody, method: "POST" });
  if (!signIn.ok) {
    throw new Error(
      `login do proprietário falhou: ${errorMessage(signIn.body, `HTTP ${signIn.status}`)}`
    );
  }

  let shopSettings = await api("/api/settings/shop");
  let actualMode = (shopSettings.body as { shopMode?: unknown } | null)
    ?.shopMode;
  if (shopSettings.ok && actualMode !== options.shopMode) {
    // Instalador/admin: se o setup inicial correu com uma imagem antiga,
    // ainda conseguimos corrigir antes do emparelhamento. Numa imagem sem
    // suporte a shopMode o PUT é ignorado e a segunda leitura falha fechada.
    await api("/api/settings/shop", {
      body: { shopMode: options.shopMode },
      method: "PUT",
    });
    shopSettings = await api("/api/settings/shop");
    actualMode = (shopSettings.body as { shopMode?: unknown } | null)
      ?.shopMode;
  }
  if (!(shopSettings.ok && actualMode === options.shopMode)) {
    throw new Error(
      `a imagem instalada não aplicou shopMode=${options.shopMode} (atual: ${String(actualMode)}) — atualize PONTO_IMAGE antes de emparelhar`
    );
  }

  const cloudBefore = await api("/api/settings/cloud");
  if (!cloudBefore.ok) {
    throw new Error(
      `não foi possível ler o estado Cloud: ${errorMessage(cloudBefore.body, `HTTP ${cloudBefore.status}`)}`
    );
  }
  if ((cloudBefore.body as { paired?: boolean } | null)?.paired === true) {
    return { ownerCreated, paired: true, pairingSkipped: true };
  }

  if (!options.pairingCode) {
    throw new Error(
      "a instância ainda não está emparelhada e não foi fornecido CLOUD_PAIRING_CODE"
    );
  }

  const pair = await api("/api/settings/cloud/pair", {
    body: { apiUrl: options.cloudApiUrl, code: options.pairingCode },
    method: "POST",
  });
  if (!pair.ok) {
    throw new Error(
      `emparelhamento Cloud falhou: ${errorMessage(pair.body, `HTTP ${pair.status}`)}`
    );
  }

  const cloudAfter = await api("/api/settings/cloud");
  if ((cloudAfter.body as { paired?: boolean } | null)?.paired !== true) {
    throw new Error("o emparelhamento terminou sem marcar a instância como ligada");
  }

  return { ownerCreated, paired: true, pairingSkipped: false };
}

function decodeEnv(name: string): string {
  const encoded = process.env[`${name}_B64`];
  if (!encoded) {
    throw new Error(`variável ${name}_B64 em falta`);
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}

async function main(): Promise<void> {
  const result = await bootstrapPontoHosted({
    cloudApiUrl: decodeEnv("PONTO_CLOUD_API_URL"),
    ownerLogin: decodeEnv("PONTO_OWNER_LOGIN"),
    ownerName: decodeEnv("PONTO_OWNER_NAME"),
    ownerPassword: decodeEnv("PONTO_OWNER_PASSWORD"),
    pairingCode: process.env.PONTO_PAIRING_CODE_B64
      ? decodeEnv("PONTO_PAIRING_CODE")
      : undefined,
    setupToken: decodeEnv("PONTO_SETUP_TOKEN"),
    shopMode: "ponto_only",
    shopName: decodeEnv("PONTO_CLIENT_NAME"),
  });
  console.log(
    JSON.stringify({
      ownerCreated: result.ownerCreated,
      paired: result.paired,
      pairingSkipped: result.pairingSkipped,
    })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
