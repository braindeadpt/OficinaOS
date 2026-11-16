/**
 * Provisioning da ferramenta SQL do assistente IA — corre no arranque
 * (start:prod) e pode ser invocado à mão (`bun run provision:analyst`)
 * para rodar a password (apaga primeiro <UPLOAD_DIR>/.secrets/analyst-ro.pass)
 * ou diagnosticar uma loja onde a tool ficou desligada.
 *
 * Idempotente e nunca fatal: sai sempre 0 — sem privilégio a tool fica
 * desligada (fail-closed) e a app sobe na mesma.
 *
 * Caso DBA (BD gerida sem CREATEROLE no user da app): um DBA corre —
 *   CREATE ROLE analyst_ro_<db> LOGIN PASSWORD '…';
 *   GRANT USAGE ON SCHEMA analyst TO analyst_ro_<db>;
 *   GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_ro_<db>;
 * e define ANALYST_DATABASE_URL no .env — este script passa a no-op.
 */
import { ensureAnalystProvisioned } from "../ai/analyst-provision.js";

async function main(): Promise<void> {
  try {
    const result = await ensureAnalystProvisioned();
    switch (result.status) {
      case "external":
        console.log(
          "• ANALYST_DATABASE_URL definida — provisioning externo (caso DBA), nada a fazer."
        );
        return;
      case "ok":
        console.log(
          `• role ${result.role} garantido + grants em analyst.* — a tool fica ativa.`
        );
        return;
      case "no-privilege":
        console.log(
          "• sem CREATEROLE no user de DATABASE_URL — tool SQL desligada (fail-closed).\n" +
            "  Caso DBA: cria analyst_ro_<db> com LOGIN + grants em analyst.* (ver cabeçalho) " +
            "e define ANALYST_DATABASE_URL."
        );
        return;
      default:
        return;
    }
  } catch (err) {
    // Nunca rebenta o arranque por causa da tool opcional.
    console.error(
      `provision-analyst falhou (a app sobe na mesma, tool desligada): ${(err as Error).message}`
    );
  }
}

await main();
