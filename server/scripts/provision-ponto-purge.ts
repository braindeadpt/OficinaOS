/**
 * Provisioning da purga do livro de ponto — corre no arranque
 * (start:prod) depois das migrações e pode ser invocado à mão
 * (`bun run provision:ponto-purge`).
 *
 * Porque é preciso: o backup sai com --no-owner --no-privileges e os
 * papéis não vão no pg_dump — depois de um restore, a função
 * ponto_purge_expired() pertence ao utilizador do restore, os grants
 * desapareceram e o papel oficinaos_ponto_purge não existe. Sem este
 * passo a purga dos 5 anos ficava morta até intervenção manual (a
 * imutabilidade mantém-se sempre — falha fechada).
 *
 * Idempotente e nunca fatal: sai sempre 0 — sem privilégio a purga fica
 * indisponível e a app sobe na mesma.
 */
import pg from "pg";

const PLUMBING_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oficinaos_ponto_purge') THEN
    CREATE ROLE oficinaos_ponto_purge NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ponto_purge_expired') THEN
    EXECUTE 'ALTER FUNCTION ponto_purge_expired() OWNER TO oficinaos_ponto_purge';
    GRANT SELECT, DELETE ON time_entries TO oficinaos_ponto_purge;
    GRANT UPDATE ("correctsId") ON time_entries TO oficinaos_ponto_purge;
    GRANT SELECT, DELETE ON time_entry_validations TO oficinaos_ponto_purge;
    REVOKE ALL ON FUNCTION ponto_purge_expired() FROM PUBLIC;
    EXECUTE format('GRANT EXECUTE ON FUNCTION ponto_purge_expired() TO %I', current_user);
  END IF;
END $$;
`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("• DATABASE_URL em falta — provisioning da purga adiado.");
    return;
  }
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(PLUMBING_SQL);
    console.log(
      "• papel oficinaos_ponto_purge + ownership/grants da purga garantidos."
    );
  } catch (err) {
    // Nunca rebenta o arranque: sem este passo a purga fica
    // indisponível mas a imutabilidade continua absoluta (fail-closed).
    console.error(
      `provision-ponto-purge falhou (a app sobe na mesma, purga indisponível): ${(err as Error).message}`
    );
  } finally {
    await client.end().catch(() => {
      // encerramento best-effort — nunca fatal
    });
  }
}

await main();
