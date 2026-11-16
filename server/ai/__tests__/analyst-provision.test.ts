/**
 * Unit tests — analyst role derivation, secret file handling and the
 * getAnalystClient cache/backoff/refusal contract. No Postgres needed:
 * connection behavior is exercised against closed ports and envs that
 * point nowhere, plus the skip-if-unreachable integration file covers
 * the happy path.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "../../config/env.js";
import {
  analystClientDebugState,
  getAnalystClient,
  resetAnalystClientForTests,
} from "../analyst-client.js";
import {
  analystDatabaseUrl,
  analystRoleName,
  analystSecretPath,
  readAnalystPassword,
} from "../analyst-provision.js";

const savedEnv = { ...process.env };
let tmp: string | null = null;

afterEach(async () => {
  await resetAnalystClientForTests();
  Object.assign(process.env, savedEnv);
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key];
    }
  }
  resetEnvForTests();
  if (tmp) {
    rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

describe("analystRoleName — per-database role", () => {
  it("sanitizes to a valid identifier and stays under 63 chars", () => {
    expect(analystRoleName("reparilo")).toBe("analyst_ro_reparilo");
    expect(analystRoleName("Minha-Loja.2")).toBe("analyst_ro_minha_loja_2");
    const long = analystRoleName("x".repeat(100));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.startsWith("analyst_ro_")).toBe(true);
  });

  it("derives different roles for different databases", () => {
    expect(analystRoleName("loja_a")).not.toBe(analystRoleName("loja_b"));
  });
});

describe("analyst password file", () => {
  it("round-trips through <UPLOAD_DIR>/.secrets with mode 600", () => {
    tmp = mkdtempSync(join(tmpdir(), "analyst-pw-"));
    const dir = join(tmp, "uploads");
    // Não há setter público — escrever direto é o que o provision faz.
    mkdirSync(join(dir, ".secrets"), { recursive: true });
    writeFileSync(analystSecretPath(dir), "segredo-teste", { mode: 0o600 });
    expect(readAnalystPassword(dir)).toBe("segredo-teste");
    if (process.platform !== "win32") {
      // permissões POSIX exatas: rw do dono, mais nada
      expect(statSync(analystSecretPath(dir)).mode % 0o1000).toBe(0o600);
    }
    expect(readFileSync(analystSecretPath(dir), "utf8")).toBe("segredo-teste");
  });

  it("returns null when the file does not exist", () => {
    tmp = mkdtempSync(join(tmpdir(), "analyst-pw-"));
    expect(readAnalystPassword(join(tmp, "uploads"))).toBeNull();
  });
});

describe("analystDatabaseUrl", () => {
  it("prefers the explicit ANALYST_DATABASE_URL (DBA case)", () => {
    process.env.ANALYST_DATABASE_URL =
      "postgresql://analyst_ro_loja:x@db.exemplo:5432/loja";
    resetEnvForTests();
    expect(analystDatabaseUrl()).toBe(process.env.ANALYST_DATABASE_URL);
  });

  it("derives user/role/password from DATABASE_URL + secret file", () => {
    tmp = mkdtempSync(join(tmpdir(), "analyst-pw-"));
    const dir = join(tmp, "uploads");
    mkdirSync(join(dir, ".secrets"), { recursive: true });
    writeFileSync(analystSecretPath(dir), "pw-ficheiro", { mode: 0o600 });

    delete process.env.ANALYST_DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://reparilo:pass@localhost:5432/minha_loja";
    process.env.UPLOAD_DIR = dir;
    resetEnvForTests();

    const url = new URL(analystDatabaseUrl() as string);
    expect(url.username).toBe("analyst_ro_minha_loja");
    expect(url.password).toBe("pw-ficheiro");
    expect(url.hostname).toBe("localhost");
    expect(url.pathname).toBe("/minha_loja");
  });

  it("is null when neither URL nor password file exist", () => {
    tmp = mkdtempSync(join(tmpdir(), "analyst-pw-"));
    delete process.env.ANALYST_DATABASE_URL;
    process.env.UPLOAD_DIR = join(tmp, "uploads");
    resetEnvForTests();
    expect(analystDatabaseUrl()).toBeNull();
  });
});

describe("getAnalystClient — cache/backoff contract", () => {
  it("returns null fast when nothing is provisioned", async () => {
    tmp = mkdtempSync(join(tmpdir(), "analyst-pw-"));
    delete process.env.ANALYST_DATABASE_URL;
    process.env.UPLOAD_DIR = join(tmp, "uploads");
    resetEnvForTests();
    expect(await getAnalystClient()).toBeNull();
  });

  it("does not cache a transient failure — retries with backoff", async () => {
    // Porta fechada: a ligação recusa-se rápido (ECONNREFUSED), não timeout.
    process.env.ANALYST_DATABASE_URL =
      "postgresql://analyst_ro_x:pw@127.0.0.1:1/x";
    resetEnvForTests();
    expect(await getAnalystClient()).toBeNull();
    // A falha transitória marcou backoff ~30s e não ficou cacheada como
    // sucesso — o próximo pedido resolve null sem nova tentativa real.
    const { nextAttemptAt, refusedWrongRole } = analystClientDebugState();
    expect(refusedWrongRole).toBe(false);
    expect(nextAttemptAt).toBeGreaterThan(Date.now());
    expect(nextAttemptAt).toBeLessThanOrEqual(Date.now() + 31_000);
    expect(await getAnalystClient()).toBeNull();
  });
});
