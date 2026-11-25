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
 *  5. a função de purga pertence ao papel próprio oficinaos_ponto_purge;
 *  6. (A1) com SET ROLE oficinaos_ponto_purge: DELETE de um registo
 *     dentro dos 5 anos falha, o de um expirado passa; UPDATE só passa
 *     para correctsId → NULL com o alvo fora da retenção — anular o link
 *     de uma correção a um registo dentro do prazo falha, como falha
 *     qualquer outra escrita em correctsId;
 *  7. (A2) TRUNCATE das tabelas do livro falha sem o GUC de intenção e
 *     passa com SET LOCAL oficinaos.ponto_truncate='on' na transação;
 *  8. (A3) time_entry_validations é só-acrescento: UPDATE/DELETE falham
 *     como dono e como papel da purga; a validação só desaparece em
 *     cascata com o delete fiscalizado do registo pai.
 */

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL em falta — o teste corre contra uma BD real");
}
// A limpeza faz TRUNCATE do livro inteiro: recusa tudo o que não pareça
// uma base descartável de teste.
const dbName = new URL(url).pathname.replace("/", "");
// 'test' como palavra inteira — "oficina_latest" não pode passar.
if (!/(^|_)test(_|$)/.test(dbName)) {
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

/** Corre o SQL e devolve true se falhar com um erro que contenha needle. */
async function expectDbError(
  sql: string,
  params: unknown[],
  needle: string,
  conn: pg.Client = client
): Promise<boolean> {
  try {
    await conn.query(sql, params);
    return false;
  } catch (err) {
    return String(err).includes(needle);
  }
}

async function expectImmutableError(
  sql: string,
  params: unknown[] = []
): Promise<boolean> {
  return expectDbError(sql, params, "imutável");
}

const userId = `probe-immutable-${Date.now()}`;
const entryId = `probe-entry-${Date.now()}`;
const oldEntryId = `probe-entry-old-${Date.now()}`;

/** Ligação descartável já com SET ROLE oficinaos_ponto_purge — reproduz
 *  exatamente o cenário do A1 (a app em Docker é superuser e pode assumir
 *  o papel em qualquer sessão). */
async function asPurgeRole(): Promise<pg.Client> {
  const conn = new pg.Client({ connectionString: url });
  await conn.connect();
  await conn.query("SET ROLE oficinaos_ponto_purge");
  return conn;
}

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

  // ── A1: SET ROLE oficinaos_ponto_purge — o trigger impõe a regra ─────
  // Preparação: um registo expirado com validação e uma correção retida
  // a apontar-lhe (para o delete), mais duas correções para os UPDATEs —
  // uma a apontar para um expirado, outra para o registo recente.
  const srOld = `${oldEntryId}-sr`;
  const srCorrExpired = `${entryId}-sr-corr-exp`;
  const srCorrRecent = `${entryId}-sr-corr-rec`;
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs)
     VALUES ($1, $2, 'ENTRADA', now() - interval '6 years', 'SMS', 'APROVADO', '{}')`,
    [srOld, userId]
  );
  await client.query(
    `INSERT INTO time_entry_validations (id, "entryId", decision, "byUserId", at)
     VALUES ($1, $2, 'APROVADO', $3, now() - interval '6 years')`,
    [`${srOld}-val`, srOld, userId]
  );
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs, "correctsId")
     VALUES ($1, $2, 'SAIDA', now() - interval '2 hours', 'SMS', 'APROVADO', '{}', $3)`,
    [srCorrExpired, userId, srOld]
  );
  await client.query(
    `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs, "correctsId")
     VALUES ($1, $2, 'SAIDA', now() - interval '1 hour', 'SMS', 'APROVADO', '{}', $3)`,
    [srCorrRecent, userId, entryId]
  );

  const purgeConn = await asPurgeRole();
  try {
    // DELETE dentro da retenção falha mesmo com o papel da purga.
    ok(
      "A1: SET ROLE purga — DELETE de registo com 2 horas falha",
      await expectDbError(
        `DELETE FROM time_entries WHERE id = $1`,
        [entryId],
        "imutável",
        purgeConn
      )
    );

    // DELETE fora da retenção passa — e leva a validação em cascata,
    // anulando o correctsId da correção retida pela cascata interna da
    // FK (que corre como dono da tabela, não como o papel).
    await purgeConn.query(`DELETE FROM time_entries WHERE id = $1`, [srOld]);
    const casc = await client.query<{
      entry: number;
      validation: number;
      correction: number;
      link: string | null;
    }>(
      `SELECT (SELECT count(*)::int FROM time_entries WHERE id = $1) AS entry,
              (SELECT count(*)::int FROM time_entry_validations WHERE "entryId" = $1) AS validation,
              (SELECT count(*)::int FROM time_entries WHERE id = $2) AS correction,
              (SELECT "correctsId" FROM time_entries WHERE id = $2) AS link`,
      [srOld, srCorrExpired]
    );
    ok(
      "A1: SET ROLE purga — DELETE de registo com 6 anos passa",
      casc.rows[0]?.entry === 0
    );
    ok(
      "A3: a validação caiu em cascata com o registo purgado",
      casc.rows[0]?.validation === 0
    );
    ok(
      "A1: a cascata da FK anulou correctsId e a correção retida sobreviveu",
      casc.rows[0]?.correction === 1 && casc.rows[0]?.link === null
    );

    // UPDATE arbitrário de correctsId (valor não-nulo) falha.
    ok(
      "A1: SET ROLE purga — UPDATE correctsId para valor não-nulo falha",
      await expectDbError(
        `UPDATE time_entries SET "correctsId" = $2 WHERE id = $1`,
        [srCorrRecent, srCorrExpired],
        "imutável",
        purgeConn
      )
    );

    // correctsId → NULL a apontar para registo DENTRO do prazo falha:
    // anular o link de uma correção a um registo vivo é mutar o livro.
    ok(
      "A1: SET ROLE purga — correctsId → NULL com alvo dentro dos 5 anos falha",
      await expectDbError(
        `UPDATE time_entries SET "correctsId" = NULL WHERE id = $1`,
        [srCorrRecent],
        "imutável",
        purgeConn
      )
    );
    const linkKept = await client.query<{ correctsId: string | null }>(
      `SELECT "correctsId" FROM time_entries WHERE id = $1`,
      [srCorrRecent]
    );
    ok(
      "A1: o link da correção ao registo vivo sobreviveu",
      linkKept.rows[0]?.correctsId === entryId
    );

    // correctsId → NULL com alvo expirado passa (é o passo da purga).
    // Nota: srCorrExpired já perdeu o link pela cascata acima — usa-se
    // uma correção nova a apontar para outro expirado ainda existente.
    const srOld2 = `${oldEntryId}-sr2`;
    const srCorr2 = `${entryId}-sr-corr2`;
    await client.query(
      `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs)
       VALUES ($1, $2, 'ENTRADA', now() - interval '6 years', 'SMS', 'APROVADO', '{}')`,
      [srOld2, userId]
    );
    await client.query(
      `INSERT INTO time_entries (id, "userId", type, at, transport, status, proofs, "correctsId")
       VALUES ($1, $2, 'SAIDA', now() - interval '2 hours', 'SMS', 'APROVADO', '{}', $3)`,
      [srCorr2, userId, srOld2]
    );
    let unlinkPassed = false;
    try {
      await purgeConn.query(
        `UPDATE time_entries SET "correctsId" = NULL WHERE id = $1`,
        [srCorr2]
      );
      unlinkPassed = true;
    } catch {
      unlinkPassed = false;
    }
    const unlinked = await client.query<{ correctsId: string | null }>(
      `SELECT "correctsId" FROM time_entries WHERE id = $1`,
      [srCorr2]
    );
    ok(
      "A1: SET ROLE purga — correctsId → NULL com alvo expirado passa",
      unlinkPassed && unlinked.rows[0]?.correctsId === null
    );

    // ── A3: validações só-acrescento ─────────────────────────────────
    // Uma validação num registo vivo não se apaga nem se altera — nem
    // com o papel da purga.
    const liveVal = `${entryId}-val`;
    await client.query(
      `INSERT INTO time_entry_validations (id, "entryId", decision, "byUserId")
       VALUES ($1, $2, 'RECUSADO', $3)`,
      [liveVal, entryId, userId]
    );
    ok(
      "A3: SET ROLE purga — DELETE direto de validação falha",
      await expectDbError(
        `DELETE FROM time_entry_validations WHERE id = $1`,
        [liveVal],
        "só-acrescento",
        purgeConn
      )
    );

    // UPDATE com o papel da purga falha ainda antes de chegar ao trigger
    // — o papel não tem UPDATE na tabela. Se um dia um provisioning lhe
    // der esse privilégio por engano, passa a ser o trigger a responder:
    // qualquer dos dois erros é falha fechada.
    let updateDenied = false;
    try {
      await purgeConn.query(
        `UPDATE time_entry_validations SET decision = 'APROVADO' WHERE id = $1`,
        [liveVal]
      );
    } catch (err) {
      const msg = String(err);
      updateDenied =
        msg.includes("permission denied") || msg.includes("só-acrescento");
    }
    ok(
      "A3: SET ROLE purga — UPDATE de validação falha (permissão ou trigger)",
      updateDenied
    );

    // ── SEC: search_path sombreado não esconde o livro real ──────────
    // Antes da correção: um schema sombra com uma time_entries vazia +
    // GRANT USAGE/SELECT ao papel da purga fazia o NOT EXISTS do trigger
    // dar sempre verdade — validações apagáveis e links de correção
    // anuláveis em registos vivos. Reproduzido em Postgres 16; aqui fica
    // a regressão.
    await client.query("DROP SCHEMA IF EXISTS probe_evil CASCADE");
    await client.query("CREATE SCHEMA probe_evil");
    await client.query("CREATE TABLE probe_evil.time_entries (id text)");
    await client.query(
      "GRANT USAGE ON SCHEMA probe_evil TO oficinaos_ponto_purge"
    );
    await client.query(
      "GRANT SELECT ON probe_evil.time_entries TO oficinaos_ponto_purge"
    );
    const evilConn = new pg.Client({ connectionString: url });
    await evilConn.connect();
    try {
      await evilConn.query("SET search_path = probe_evil, public");
      await evilConn.query("SET ROLE oficinaos_ponto_purge");
      ok(
        "SEC: search_path sombreado não abre o DELETE de validações",
        await expectDbError(
          `DELETE FROM public.time_entry_validations WHERE id = $1`,
          [liveVal],
          "só-acrescento",
          evilConn
        )
      );
      ok(
        "SEC: search_path sombreado não anula correctsId em registo vivo",
        await expectDbError(
          `UPDATE public.time_entries SET "correctsId" = NULL WHERE id = $1`,
          [srCorrRecent],
          "imutável",
          evilConn
        )
      );
    } finally {
      await evilConn.end().catch(() => {
        // encerramento best-effort
      });
      await client.query("DROP SCHEMA IF EXISTS probe_evil CASCADE");
    }
  } finally {
    await purgeConn.end().catch(() => {
      // encerramento best-effort
    });
  }

  // Como dono da tabela o resultado é o mesmo — e aqui é o próprio
  // trigger que responde (não permissões de coluna).
  const liveValId = `${entryId}-val`;
  ok(
    "A3: UPDATE de validação como dono falha",
    await expectDbError(
      `UPDATE time_entry_validations SET decision = 'APROVADO' WHERE id = $1`,
      [liveValId],
      "só-acrescento"
    )
  );
  ok(
    "A3: DELETE de validação como dono falha",
    await expectDbError(
      `DELETE FROM time_entry_validations WHERE id = $1`,
      [liveValId],
      "só-acrescento"
    )
  );
  const valKept = await client.query<{ decision: string }>(
    `SELECT decision::text FROM time_entry_validations WHERE id = $1`,
    [liveValId]
  );
  ok(
    "A3: o RECUSADO continua intacto",
    valKept.rows.length === 1 && valKept.rows[0]?.decision === "RECUSADO"
  );

  // ── A2: TRUNCATE tem de declarar intenção ────────────────────────────
  // Negativo: dentro de transação para o ROLLBACK desfazer se o guarda
  // falhar — TRUNCATE em Postgres é transacional.
  await client.query("BEGIN");
  const truncEntriesBlocked = await expectDbError(
    "TRUNCATE time_entries CASCADE",
    [],
    "não admite TRUNCATE"
  );
  await client.query("ROLLBACK");
  ok("A2: TRUNCATE time_entries sem o GUC falha", truncEntriesBlocked);

  await client.query("BEGIN");
  const truncValsBlocked = await expectDbError(
    "TRUNCATE time_entry_validations",
    [],
    "não admite TRUNCATE"
  );
  await client.query("ROLLBACK");
  ok(
    "A2: TRUNCATE time_entry_validations sem o GUC falha",
    truncValsBlocked
  );

  // Positivo: com SET LOCAL dentro da transação o wipe passa — e o GUC
  // morre com ela.
  await client.query("BEGIN");
  await client.query("SET LOCAL oficinaos.ponto_truncate = 'on'");
  let truncWithGuc = true;
  try {
    await client.query("TRUNCATE time_entries, time_entry_validations");
  } catch {
    truncWithGuc = false;
  }
  await client.query("COMMIT");
  ok("A2: TRUNCATE com SET LOCAL oficinaos.ponto_truncate passa", truncWithGuc);
  const afterTrunc = await client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM time_entries"
  );
  ok("A2: o wipe com GUC esvaziou mesmo o livro", afterTrunc.rows[0]?.n === 0);

  await client.query("BEGIN");
  const truncAfterCommitBlocked = await expectDbError(
    "TRUNCATE time_entries CASCADE",
    [],
    "não admite TRUNCATE"
  );
  await client.query("ROLLBACK");
  ok(
    "A2: o GUC morre com a transação — TRUNCATE volta a falhar",
    truncAfterCommitBlocked
  );

  // Um caller sem privilégio não executa a purga (REVOKE de PUBLIC) —
  // e o papel operacional das migrações tem EXECUTE explícito.
  await client.query("DROP ROLE IF EXISTS probe_purge_noperms").catch(() => {
    // a primeira corrida ainda não tem o papel — ignora
  });
  await client.query("CREATE ROLE probe_purge_noperms NOLOGIN");
  // USAGE no schema para a única barreira ser o EXECUTE — sem ele a
  // função nem é visível e o erro não prova nada sobre o REVOKE.
  await client.query("GRANT USAGE ON SCHEMA public TO probe_purge_noperms");
  const probe = new pg.Client({ connectionString: url });
  await probe.connect();
  let denied = false;
  try {
    await probe.query("SET ROLE probe_purge_noperms");
    await probe.query("SELECT ponto_purge_expired()");
  } catch (err) {
    denied = String(err).includes("permission denied");
  } finally {
    await probe.end().catch(() => {
      // encerramento best-effort
    });
  }
  await client.query(
    "REVOKE USAGE ON SCHEMA public FROM probe_purge_noperms"
  );
  await client.query("DROP ROLE probe_purge_noperms");
  ok("caller sem EXECUTE não corre a purga", denied);

  const execGrant = await client.query<{ has: boolean }>(
    "SELECT has_function_privilege(current_user, 'ponto_purge_expired()', 'EXECUTE') AS has"
  );
  ok(
    "o papel operacional tem EXECUTE explícito na purga",
    execGrant.rows[0]?.has === true
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
  // DELETE (é esse o ponto) — o TRUNCATE tem de declarar intenção com o
  // GUC dentro da transação, como o reset de demo.
  await client.query("BEGIN").catch(() => {
    // limpeza best-effort
  });
  await client
    .query("SET LOCAL oficinaos.ponto_truncate = 'on'")
    .catch(() => {
      // limpeza best-effort
    });
  await client.query("TRUNCATE time_entries CASCADE").catch(() => {
    // limpeza best-effort
  });
  await client.query("COMMIT").catch(() => {
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
