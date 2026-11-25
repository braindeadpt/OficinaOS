#!/usr/bin/env bun
/**
 * WP0.3 — teste de imutabilidade do livro de ponto AO NÍVEL DA BD.
 * Corre na CI (job check) contra o Postgres migrado; precisa de
 * DATABASE_URL a apontar para uma base descartável.
 *
 * Verifica:
 *  1. UPDATE em time_entries falha sempre;
 *  2. DELETE em time_entries falha sempre;
 *  3. o escape antigo (SET oficinaos.ponto_purge='on') já não abre nada;
 *  4. a purga SECURITY DEFINER apaga só registos com mais de 5 anos —
 *     os mais recentes sobrevivem;
 *  5. a função de purga pertence ao papel próprio oficinaos_ponto_purge.
 */

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL em falta — o teste corre contra uma BD real");
}
// A limpeza faz TRUNCATE do livro inteiro (é imutável — não há DELETE):
// recusa tudo o que não pareça uma base descartável de teste.
const dbName = new URL(url).pathname.replace("/", "");
if (!dbName.includes("test")) {
  throw new Error(
    `DATABASE_URL aponta para '${dbName}' — o teste destrói os dados e só corre contra bases com 'test' no nome`
  );
}

const client = new pg.Client({ connectionString: url });
await client.connect();

let failures = 0;
function ok(name: string, pass: boolean, detail = ""): void {
  if (pass) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FALHOU ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectImmutableError(
  sql: string,
  params: unknown[] = []
): Promise<boolean> {
  try {
    await client.query(sql, params);
    return false;
  } catch (err) {
    return String(err).includes("imutável");
  }
}

const userId = `probe-immutable-${Date.now()}`;
const entryId = `probe-entry-${Date.now()}`;
const oldEntryId = `probe-entry-old-${Date.now()}`;

try {
  await client.query(
    `INSERT INTO users (id, username, email, role, "createdAt", "updatedAt") VALUES ($1, $2, $3, 'TECHNICIAN', now(), now())`,
    [userId, userId, `${userId}@probe.local`]
  );
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs)
     VALUES ($1, $2, 'ENTRADA', now() - interval '2 hours', 'SMS', 'APROVADO', '{}')`,
    [entryId, userId]
  );

  ok(
    "UPDATE em time_entries falha",
    await expectImmutableError(
      `UPDATE time_entries SET type = 'SAIDA' WHERE id = $1`,
      [entryId]
    )
  );
  ok(
    "DELETE em time_entries falha",
    await expectImmutableError(`DELETE FROM time_entries WHERE id = $1`, [
      entryId,
    ])
  );

  // O escape antigo — SET LOCAL dentro de transação — já não abre nada.
  await client.query("BEGIN");
  await client.query("SET LOCAL oficinaos.ponto_purge = 'on'");
  const gucStillWorks = await expectImmutableError(
    `DELETE FROM time_entries WHERE id = $1`,
    [entryId]
  );
  await client.query("ROLLBACK");
  ok("SET oficinaos.ponto_purge='on' já não contorna o trigger", gucStillWorks);

  // Purga: uma linha com 6 anos cai, uma com 2 horas fica. Uma terceira
  // corrige a antiga (correctsId) — a purga exercita também o SET NULL
  // da FK auto-referenciada.
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs)
     VALUES ($1, $2, 'ENTRADA', now() - interval '6 years', 'SMS', 'APROVADO', '{}')`,
    [oldEntryId, userId]
  );
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs, "correctsId")
     VALUES ($1, $2, 'SAIDA', now() - interval '6 years' + interval '8 hours', 'SMS', 'APROVADO', '{}', $3)`,
    [`${oldEntryId}-corr`, userId, oldEntryId]
  );
  const purge = await client.query<{ ponto_purge_expired: string }>(
    "SELECT ponto_purge_expired()"
  );
  ok(
    "ponto_purge_expired() apagou exatamente as 2 linhas com 6 anos",
    purge.rows[0]?.ponto_purge_expired === "2",
    `devolveu ${purge.rows[0]?.ponto_purge_expired}`
  );
  const survivors = await client.query<{ id: string }>(
    `SELECT id FROM time_entries WHERE id = ANY($1)`,
    [[entryId, oldEntryId]]
  );
  ok(
    "a linha recente sobreviveu e a antiga desapareceu",
    survivors.rows.length === 1 && survivors.rows[0]?.id === entryId
  );

  // Cenário da correção retida: correção dentro do prazo a apontar para
  // uma linha expirada — sem o UPDATE prévio o SET NULL da FK abortava
  // a purga inteira.
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs)
     VALUES ($1, $2, 'ENTRADA', now() - interval '6 years', 'SMS', 'APROVADO', '{}')`,
    [`${oldEntryId}-2`, userId]
  );
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs, "correctsId")
     VALUES ($1, $2, 'SAIDA', now() - interval '2 hours', 'SMS', 'APROVADO', '{}', $3)`,
    [`${entryId}-corr`, userId, `${oldEntryId}-2`]
  );
  const purge2 = await client.query<{ ponto_purge_expired: string }>(
    "SELECT ponto_purge_expired()"
  );
  ok(
    "purga com correção retida não aborta",
    purge2.rows[0]?.ponto_purge_expired === "1",
    `devolveu ${purge2.rows[0]?.ponto_purge_expired}`
  );
  const kept = await client.query<{ correctsId: string | null }>(
    `SELECT "correctsId" FROM time_entries WHERE id = $1`,
    [`${entryId}-corr`]
  );
  ok(
    "a correção retida sobrevive com correctsId anulado",
    kept.rows.length === 1 && kept.rows[0]?.correctsId === null
  );

  const owner = await client.query<{ owner: string }>(
    `SELECT r.rolname AS owner
       FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'ponto_purge_expired'`
  );
  ok(
    "ponto_purge_expired pertence ao papel oficinaos_ponto_purge",
    owner.rows[0]?.owner === "oficinaos_ponto_purge",
    `dono atual: ${owner.rows[0]?.owner ?? "?"}`
  );
} finally {
  // Limpeza best-effort: as linhas de teste não podem ser apagadas por
  // DELETE (é esse o ponto) — TRUNCATE não dispara triggers de linha.
  await client.query("TRUNCATE time_entries CASCADE").catch(() => {
      // limpeza best-effort
    });
  await client
    .query("DELETE FROM users WHERE id = $1", [userId])
    .catch(() => {
      // limpeza best-effort
    });
  await client.end();
}

if (failures > 0) {
  console.error(`\n${failures} verificações falharam`);
  process.exit(1);
}
console.log("\nimutabilidade do ponto verificada ao nível da BD");
