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
      if (url.pathname === "/mcp/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (url.pathname !== "/mcp") {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      const plaintext = bearerToken(req);
      const auth = plaintext
        ? await authenticateToken(prisma, plaintext)
        : null;
      if (!auth) {
        sendJson(res, 401, { error: "unauthorized" });
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
      const mcpServer = buildMcpServer(prisma, auth);
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
export function startMcpHttpServer(
  prisma: PrismaClient,
  port = Number(process.env.MCP_PORT) || MCP_DEFAULT_PORT
): { server: Server; port: number } | null {
  if (process.env.MCP_DISABLED === "true") {
    return null;
  }
  const server = createMcpHttpServer(prisma);
  server.listen(port, MCP_BIND_HOST);
  return { server, port };
}
