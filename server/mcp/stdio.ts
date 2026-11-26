#!/usr/bin/env bun
/**
 * oficinaos-mcp — servidor MCP stdio só de leitura.
 *
 * Uso: bunx oficinaos-mcp --token oos_…
 *
 * Lê a mesma base de dados da app (DATABASE_URL do ambiente ou do .env na
 * pasta atual) e aplica exatamente o mesmo núcleo do servidor HTTP loopback:
 * permissões herdadas do utilizador, mascaramento RGPD, rate limit e
 * auditoria. Não escreve nada — não existem ferramentas de escrita.
 *
 * Em Docker (a app corre num contentor): configurar o cliente com
 *   command: docker
 *   args: ["compose","-f","/caminho/docker-compose.yml","exec","-T","app",
 *          "bunx","oficinaos-mcp","--token","oos_…"]
 */
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/client";
import { buildMcpServer } from "./server.js";
import { authenticateToken } from "./tokens.js";

const DATABASE_URL_LINE = /^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?\s*$/;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  try {
    // .env da instalação — parser mínimo, sem dependências.
    const envFile = readFileSync(".env", "utf8");
    for (const line of envFile.split("\n")) {
      const match = DATABASE_URL_LINE.exec(line);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // cai no erro abaixo
  }
  process.stderr.write(
    "oficinaos-mcp: DATABASE_URL não encontrada (nem no ambiente nem no .env)\n"
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const token = argValue("--token") ?? process.env.MCP_TOKEN;
  if (!token) {
    process.stderr.write(
      "oficinaos-mcp: falta --token oos_… (cria-o em Definições → IA)\n"
    );
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: loadDatabaseUrl() });
  const prisma = new PrismaClient({ adapter });

  const auth = await authenticateToken(prisma, token);
  if (!auth) {
    process.stderr.write(
      "oficinaos-mcp: token inválido, revogado ou expirado\n"
    );
    process.exit(1);
  }

  const server = buildMcpServer(prisma, auth);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("oficinaos-mcp: ligado (só leitura)\n");
}

main().catch((err) => {
  process.stderr.write(
    `oficinaos-mcp: erro fatal: ${err instanceof Error ? err.message : err}\n`
  );
  process.exit(1);
});
