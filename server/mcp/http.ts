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
const ipWindows = new Map<string, number[]>();
const IP_RATE_LIMIT_PER_MINUTE = 60;

function ipRateLimitOk(ip: string, now = Date.now()): boolean {
  const stamps = (ipWindows.get(ip) ?? []).filter((t) => now - t < 60_000);
  ipWindows.set(ip, stamps);
  return stamps.length < IP_RATE_LIMIT_PER_MINUTE;
}

// Em loopback todos os clientes partilham o mesmo IP — a quota só é consumida
// por falhanços de autenticação (força bruta), nunca por tráfego legítimo.
// O consumo é síncrono ANTES da consulta à BD (reembolsado no sucesso), para
// que tentativas sobrepostas não passem todas antes da primeira falha contar.
function consumeIpAttempt(ip: string, now = Date.now()): void {
  const stamps = (ipWindows.get(ip) ?? []).filter((t) => now - t < 60_000);
  stamps.push(now);
  ipWindows.set(ip, stamps);
}

function refundIpAttempt(ip: string, now = Date.now()): void {
  const stamps = (ipWindows.get(ip) ?? []).filter((t) => now - t < 60_000);
  stamps.pop();
  ipWindows.set(ip, stamps);
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

export function createMcpHttpServer(prisma: PrismaClient): Server {
  return createServer((req, res) => {
    const handle = async () => {
      const url = new URL(req.url ?? "/", `http://${MCP_BIND_HOST}`);
      const ip = req.socket.remoteAddress ?? "unknown";
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
      consumeIpAttempt(ip);
      const auth = plaintext
        ? await authenticateToken(prisma, plaintext)
        : null;
      if (!auth) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      refundIpAttempt(ip);
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
      if (res.headersSent) {
        res.end();
      } else {
        sendJson(res, 500, {
          error: "internal",
          message: err instanceof Error ? err.message : "unknown",
        });
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
