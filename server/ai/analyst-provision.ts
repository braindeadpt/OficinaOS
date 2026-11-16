/**
 * Provisioning da ferramenta SQL do assistente IA — lógica partilhada
 * entre o arranque automático (start:prod) e o script manual
 * (server/scripts/provision-analyst.ts, caso DBA).
 *
 * O role é derivado da base de dados (`analyst_ro_<db>`): roles são
 * globais ao cluster — duas BDs OficinaOS no mesmo Postgres não podem
 * partilhar um role com LOGIN, senão um conseguia ligar-se à BD da
 * outra (CONNECT vem de PUBLIC) e a rotação de uma afetava a outra.
 *
 * A password vive num ficheiro de dados persistente — nunca no .env,
 * nunca em logs, nunca no repo:
 *   <UPLOAD_DIR>/.secrets/analyst-ro.pass   (modo 600)
 * Em Docker isso é o volume `uploads`; no Windows, a pasta de dados da
 * instalação. Gerada uma vez — não é rodada a cada arranque.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { loadEnv } from "../config/env.js";

const ROLE_PREFIX = "analyst_ro_";
const NON_IDENT_RE = /[^a-z0-9_]/g;
const IDENT_MAX = 63;
const QUOTE_RE = /'/g;

/** analyst_ro_<db>, sanitizado a identificador e cortado a 63 chars. */
export function analystRoleName(dbName: string): string {
  const clean = dbName.toLowerCase().replace(NON_IDENT_RE, "_");
  return `${ROLE_PREFIX}${clean.slice(0, IDENT_MAX - ROLE_PREFIX.length)}`;
}

export function analystSecretPath(uploadDir: string): string {
  return join(uploadDir, ".secrets", "analyst-ro.pass");
}

/** Lê a password persistida; null se ainda não existe. */
export function readAnalystPassword(uploadDir: string): string | null {
  const path = analystSecretPath(uploadDir);
  if (!existsSync(path)) {
    return null;
  }
  const pw = readFileSync(path, "utf8").trim();
  return pw.length > 0 ? pw : null;
}

function writeAnalystPassword(uploadDir: string, password: string): void {
  const path = analystSecretPath(uploadDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, password, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ignora POSIX modes — o ficheiro fica protegido pela ACL da pasta.
  }
}

export type ProvisionResult =
  | { status: "ok"; role: string }
  | { status: "no-privilege" }
  | { status: "external" };

/**
 * Garante role + grants + password para ESTA base de dados. Idempotente:
 * role criado só se não existir; password nova só se o ficheiro não
 * existir (se o role existe e o ficheiro sumiu, gera nova e aplica
 * ALTER ROLE — o ficheiro é a fonte da verdade).
 *
 * Nunca lança por falta de privilégio — devolve "no-privilege" e a tool
 * fica desligada (fail-closed).
 */
export async function ensureAnalystProvisioned(): Promise<ProvisionResult> {
  const env = loadEnv();
  if (env.ANALYST_DATABASE_URL) {
    return { status: "external" };
  }
  const dbUrl = new URL(env.DATABASE_URL);
  const role = analystRoleName(decodeURIComponent(dbUrl.pathname.slice(1)));
  const admin = new Client({ connectionString: env.DATABASE_URL });
  await admin.connect();
  try {
    const me = await admin.query<{ rolsuper: boolean; rolcreaterole: boolean }>(
      "SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user"
    );
    if (!(me.rows[0]?.rolsuper || me.rows[0]?.rolcreaterole)) {
      return { status: "no-privilege" };
    }

    let password = readAnalystPassword(env.UPLOAD_DIR);
    const exists = await admin.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [role]
    );
    if (exists.rowCount === 0 || password === null) {
      // Role novo, ou ficheiro perdido (restauro/limpeza): password nova —
      // a do ficheiro antigo já não é conhecida por ninguém.
      password ??= randomBytes(36).toString("base64url");
      const escaped = password.replace(QUOTE_RE, "''");
      if (exists.rowCount === 0) {
        await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${escaped}'`);
      } else {
        await admin.query(
          `ALTER ROLE "${role}" WITH LOGIN PASSWORD '${escaped}'`
        );
      }
      writeAnalystPassword(env.UPLOAD_DIR, password);
    } else {
      // A migração pode ter criado o role NOLOGIN — garante LOGIN sem tocar
      // na password (idempotente, barato a cada arranque).
      await admin.query(`ALTER ROLE "${role}" WITH LOGIN`);
    }

    await admin.query(`GRANT USAGE ON SCHEMA analyst TO "${role}"`);
    await admin.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO "${role}"`
    );
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA analyst GRANT SELECT ON TABLES TO "${role}"`
    );
    return { status: "ok", role };
  } finally {
    await admin.end();
  }
}

/**
 * ANALYST_DATABASE_URL efetiva: a explícita (caso DBA) ou a derivada de
 * DATABASE_URL + password persistida (caso auto-provisionado).
 */
export function analystDatabaseUrl(): string | null {
  const env = loadEnv();
  if (env.ANALYST_DATABASE_URL) {
    return env.ANALYST_DATABASE_URL;
  }
  const password = readAnalystPassword(env.UPLOAD_DIR);
  if (!password) {
    return null;
  }
  const url = new URL(env.DATABASE_URL);
  url.username = analystRoleName(decodeURIComponent(url.pathname.slice(1)));
  url.password = password;
  return url.toString();
}
