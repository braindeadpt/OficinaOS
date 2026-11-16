/**
 * Provisiona o role `analyst_ro` (LOGIN + password) e escreve
 * ANALYST_DATABASE_URL no .env — o passo que liga a ferramenta SQL do
 * assistente IA. Idempotente: pode correr as vezes que for preciso.
 *
 * Uso:
 *   bun run provision:analyst            # gera password, escreve .env
 *   ANALYST_RO_PASSWORD=… bun run provision:analyst   # password própria
 *
 * Corre como o utilizador de DATABASE_URL, que precisa de CREATEROLE
 * (no docker-compose o utilizador reparilo é superuser — funciona).
 * Numa BD gerida sem esse privilégio, pede ao DBA:
 *   CREATE ROLE analyst_ro LOGIN PASSWORD '…';
 *   GRANT USAGE ON SCHEMA analyst TO analyst_ro;
 *   GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_ro;
 * e mete o ANALYST_DATABASE_URL à mão no .env.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { loadEnv } from "../config/env.js";

const ROLE = "analyst_ro";
const ENV_LINE = "ANALYST_DATABASE_URL";
const ENV_LINE_RE = new RegExp(`^${ENV_LINE}=.*$`, "m");
const TRAILING_NEWLINE_RE = /\n?$/;
const PERMISSION_DENIED_RE = /permission denied/i;
const QUOTE_RE = /'/g;

function main(): void {
  const env = loadEnv();
  const dbUrl = new URL(env.DATABASE_URL);
  const password =
    process.env.ANALYST_RO_PASSWORD ?? randomBytes(36).toString("base64url"); // URL-safe, sem escapes

  const run = async () => {
    const admin = new Client({ connectionString: env.DATABASE_URL });
    await admin.connect();
    try {
      const exists = await admin.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [ROLE]
      );
      if (exists.rowCount === 0) {
        await admin.query(`CREATE ROLE ${ROLE} NOLOGIN`);
        console.log(`• role ${ROLE} criado`);
      }
      // LOGIN + password renovada a cada run — rotação grátis.
      await admin.query(
        `ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password.replace(QUOTE_RE, "''")}'`
      );
      await admin.query(`GRANT USAGE ON SCHEMA analyst TO ${ROLE}`);
      await admin.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO ${ROLE}`
      );
      console.log("• grants em analyst.* aplicados");
    } finally {
      await admin.end();
    }

    dbUrl.username = ROLE;
    dbUrl.password = password;
    const line = `${ENV_LINE}="${dbUrl.toString()}"`;

    const envPath = join(process.cwd(), ".env");
    const current = readFileSync(envPath, "utf8");
    const next = current.match(ENV_LINE_RE)
      ? current.replace(ENV_LINE_RE, line)
      : `${current.replace(TRAILING_NEWLINE_RE, "\n")}\n# AI SQL tool — ligado por provision-analyst.ts\n${line}\n`;
    writeFileSync(envPath, next);

    console.log(`• ${ENV_LINE} escrito em .env`);
    console.log(
      "\nReinicia a app (docker compose up -d) — a ferramenta SQL fica ativa.\n" +
        "Sem reinício, fica desligada (fail-closed), que é o comportamento seguro."
    );
  };

  run().catch((err) => {
    console.error(`provision-analyst falhou: ${err.message}`);
    if (err.code === "42501" || PERMISSION_DENIED_RE.test(err.message)) {
      console.error(
        "O utilizador de DATABASE_URL não tem CREATEROLE. Pede a um DBA " +
          "para criar o role analyst_ro (ver cabeçalho deste script) ou corre " +
          "com o superuser do cluster."
      );
    }
    process.exit(1);
  });
}

main();
