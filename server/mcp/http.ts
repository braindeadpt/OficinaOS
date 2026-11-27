import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { PrismaClient } from "@generated/client";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./server.js";
import { authenticateToken, rateLimitOk } from "./tokens.js";

/**
 * Transporte HTTP do servidor MCP — escuta EXCLUSIVAMENTE em 127.0.0.1
 * (loopback). Nunca é ligado à rede da loja: a app serve LAN em HTTP simples
 * e um endpoint MCP aí seria alcance de leitura para toda a rede. Quem usa
 * Claude Desktop/Cursor/LM Studio na mesma máquina chega por loopback; em
 * Docker usa-se o stdio via `docker compose exec`.
 *
 * Autenticação: `Authorization: Bearer oos_…` — token pessoal, guardado só
 * como hash. 401 para desconhecido/revogado/expirado; 429 acima de 60/min.
 */

export const MCP_BIND_HOST = "127.0.0.1";
export const MCP_DEFAULT_PORT = 4100;

// Rate limit PRÉ-autenticação por IP (janela deslizante em memória) — mesmo
// em loopback, um processo local não pode forçar tokens ilimitadamente.
const ipWindows = new Map<string, Attempt[]>();
const IP_RATE_LIMIT_PER_MINUTE = 60;

interface Attempt {
  id: symbol;
  t: number;
}

function liveAttempts(ip: string, now: number): Attempt[] {
  const live = (ipWindows.get(ip) ?? []).filter((a) => now - a.t < 60_000);
  ipWindows.set(ip, live);
  return live;
}

function ipRateLimitOk(ip: string, now = Date.now()): boolean {
  return liveAttempts(ip, now).length < IP_RATE_LIMIT_PER_MINUTE;
}

// Em loopback todos os clientes partilham o mesmo IP — a quota só é consumida
// por falhanços de autenticação (força bruta), nunca por tráfego legítimo.
// O consumo é síncrono ANTES da consulta à BD e o reembolso remove a marca
// exata desta tentativa (não a mais recente) — tentativas sobrepostas não
// podem apagar as marcas umas das outras.
function consumeIpAttempt(ip: string, now = Date.now()): symbol {
  const live = liveAttempts(ip, now);
  const id = Symbol("attempt");
  live.push({ id, t: now });
  ipWindows.set(ip, live);
  return id;
}

function refundIpAttempt(ip: string, id: symbol, now = Date.now()): void {
  ipWindows.set(
    ip,
    liveAttempts(ip, now).filter((a) => a.id !== id)
  );
}

/** Só para testes — limpa as janelas de quota por IP. */
export function resetIpRateLimits(): void {
  ipWindows.clear();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

// ── Anti-DNS-rebinding ────────────────────────────────────────────────────
// Um site malicioso pode reordenar o DNS do seu domínio para 127.0.0.1 e
// fazer o browser da vítima falar com este servidor como "mesma origem" —
// aí os limites da SOP deixam de proteger. A defesa é validar que o Host
// é loopback e que um Origin presente também é. Clientes de desktop MCP
// não enviam Origin; browsers enviam sempre.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// "127.0.0.1:4100" | "localhost:4100" | "[::1]:4100" | sem porta
const HOST_RE = /^(\[[0-9a-fA-F:]+\]|[^:]*)(?::\d+)?$/;

function hostnameOf(hostHeader: string): string {
  const m = HOST_RE.exec(hostHeader.trim());
  return (m?.[1] ?? "").toLowerCase();
}

function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }
  return LOOPBACK_HOSTS.has(hostnameOf(hostHeader));
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return true; // clientes não-browser não enviam Origin
  }
  try {
    const u = new URL(origin);
    return LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function hostOriginAllowed(req: IncomingMessage): boolean {
  return (
    isLoopbackHostHeader(req.headers.host) &&
    isLoopbackOrigin(req.headers.origin as string | undefined)
  );
}

type McpAuthResult = Awaited<ReturnType<typeof authenticateToken>>;

/** Autentica o pedido e gere a quota de força bruta. Devolve null (e responde) em falha. */
async function authenticateMcpRequest(
  prisma: PrismaClient,
  plaintext: string | null,
  ip: string,
  res: ServerResponse
): Promise<McpAuthResult> {
  const attemptId = consumeIpAttempt(ip);
  let auth: McpAuthResult = null;
  try {
    auth = plaintext ? await authenticateToken(prisma, plaintext) : null;
  } catch {
    // Erro de BD não é força bruta — não fica na quota.
    refundIpAttempt(ip, attemptId);
    sendJson(res, 500, { error: "internal" });
    return null;
  }
  if (!auth) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  refundIpAttempt(ip, attemptId);
  return auth;
}

export function createMcpHttpServer(prisma: PrismaClient): Server {
  return createServer((req, res) => {
    const handle = async () => {
      const url = new URL(req.url ?? "/", `http://${MCP_BIND_HOST}`);
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!hostOriginAllowed(req)) {
        sendJson(res, 403, { error: "forbidden_host" });
        return;
      }
      if (!ipRateLimitOk(ip)) {
        sendJson(res, 429, { error: "rate_limited", limit: "60/min" });
        return;
      }
      if (url.pathname === "/mcp/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (url.pathname !== "/mcp") {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      const plaintext = bearerToken(req);
      const auth = await authenticateMcpRequest(prisma, plaintext, ip, res);
      if (!auth) {
        return;
      }
      if (!rateLimitOk(auth.tokenId)) {
        sendJson(res, 429, { error: "rate_limited", limit: "60/min" });
        return;
      }

      // Stateless: um transporte + servidor por pedido, com o token
      // autenticado fechado nos handlers das ferramentas.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcpServer = buildMcpServer(prisma, auth, async () =>
        plaintext ? authenticateToken(prisma, plaintext) : null
      );
      res.on("close", () => {
        transport.close().catch(() => undefined);
        mcpServer.close().catch(() => undefined);
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    };
    handle().catch((err: unknown) => {
      // O detalhe fica só no log do servidor — ao cliente vai texto genérico.
      console.error("mcp: erro no pedido HTTP", err);
      if (res.headersSent) {
        res.end();
      } else {
        sendJson(res, 500, { error: "internal" });
      }
    });
  });
}

/**
 * Arranca o listener loopback. Devolve a porta efetiva (0 = aleatória, usado
 * nos testes) ou null quando MCP_DISABLED=true.
 */
function defaultMcpPort(): number {
  const raw = process.env.MCP_PORT;
  if (raw === undefined || raw === "") {
    return MCP_DEFAULT_PORT;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : MCP_DEFAULT_PORT;
}

export function startMcpHttpServer(
  prisma: PrismaClient,
  port = defaultMcpPort()
): { server: Server; port: number } | null {
  if (process.env.MCP_DISABLED === "true") {
    return null;
  }
  // Porta inválida ou ocupada nunca pode derrubar a app — o MCP é um extra.
  const validPort =
    Number.isInteger(port) && port >= 0 && port < 65_536
      ? port
      : MCP_DEFAULT_PORT;
  const server = createMcpHttpServer(prisma);
  server.on("error", () => {
    // erro tratado pelo caller via evento — aqui só se garante que nada
    // lança fora do listener.
  });
  try {
    server.listen(validPort, MCP_BIND_HOST);
  } catch {
    return null;
  }
  return { server, port: validPort };
}
