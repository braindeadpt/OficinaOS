/**
 * recover-access — local password recovery for the shop OWNER.
 *
 * Runs only where the database lives: the Windows tray («Recuperar
 * acesso…», behind a UAC prompt), the portable RECUPERAR-ACESSO.bat, or
 * `bun run recover-access` / `docker compose exec app bun run
 * recover-access`. There is deliberately no HTTP route — physical access
 * to the server is the authorization proof.
 *
 *   bun run recover-access                     → list OWNER accounts
 *                                                (inactive marked)
 *   bun run recover-access -- --user <name>    → reset that account
 *   bun run recover-access -- --user <name> --reactivate
 *                                              → also re-enable an
 *                                                inactive account
 *
 * The temporary password is printed ONCE to stdout — never to logs or
 * files — and must be changed at first login (mustChangePassword).
 */
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";
import { PrismaClient } from "@generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Role } from "@shared/constants/roles";
import { hashPassword } from "better-auth/crypto";
import { loadEnv } from "../config/env.js";
import { create as auditCreate } from "../repositories/audit.repository.js";
import type { DbClient } from "../repositories/types.js";
import {
  deleteUserSessions,
  resetFailedAttempts,
  updateCredentialPassword,
  updateMustChangePassword,
  findFirst as userFindFirst,
  findMany as userFindMany,
} from "../repositories/user.repository.js";

// No ambiguous glyphs (0/O, 1/l/I/i) — the password is read off a screen
// and typed by hand.
const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 18;

export function generateTemporaryPassword(
  length = TEMP_PASSWORD_LENGTH
): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

/** Accounts recoverable locally — the admin tier (OWNER). Inactive
 *  accounts are listed too (marked) so the tray/operator can reach the
 *  --reactivate path instead of staring at an empty list. */
export function listRecoverableUsers(prisma: DbClient) {
  return userFindMany(
    prisma,
    { role: Role.OWNER },
    { username: true, name: true, role: true, isActive: true },
    { username: "asc" },
    50
  );
}

export async function recoverAccess(
  prisma: DbClient,
  username: string,
  { reactivate = false }: { reactivate?: boolean } = {}
): Promise<string> {
  const user = await userFindFirst(prisma, { username });
  if (!user) {
    throw new Error(`Utilizador "${username}" não encontrado.`);
  }
  if (user.role !== Role.OWNER) {
    throw new Error(
      `Só é possível recuperar contas OWNER ("${username}" é ${user.role}).`
    );
  }
  if (!(user.isActive || reactivate)) {
    throw new Error(
      `A conta "${username}" está inativa. Corra de novo com --reactivate para a reativar.`
    );
  }

  const password = generateTemporaryPassword();
  const hashed = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    if (!user.isActive) {
      await tx.user.update({
        where: { id: user.id },
        data: { isActive: true },
      });
    }
    await updateCredentialPassword(tx, user.id, hashed);
    await updateMustChangePassword(tx, user.id, true);
    // A conta recuperada tem de entrar já — um lockout em curso recusaria
    // a temporária válida nos minutos restantes do bloqueio.
    await resetFailedAttempts(tx, user.id);
    await deleteUserSessions(tx, user.id);
  });

  await auditCreate(prisma, {
    action: "PASSWORD_RESET",
    jobId: null,
    toValue: "Recuperação local (servidor)",
    userId: user.id,
    metadata: user.isActive ? undefined : { reactivated: true },
  });

  return password;
}

function printUsage(): void {
  console.log(
    "Uso: bun run recover-access -- [--user <username>] [--reactivate]\n" +
      "Sem --user lista as contas OWNER (inativas marcadas)."
  );
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      user: { type: "string" },
      reactivate: { type: "boolean" },
    },
    strict: true,
  });

  const env = loadEnv();
  // Same guard as the management routes — the demo is a public fixture.
  if (env.DEMO_MODE) {
    throw new Error("Recuperação local desativada em modo demo.");
  }

  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    if (!values.user) {
      const users = await listRecoverableUsers(prisma);
      if (users.length === 0) {
        console.log("Nenhuma conta OWNER ativa encontrada.");
        return;
      }
      console.log("Contas OWNER:");
      for (const u of users) {
        console.log(
          `  ${u.username}${u.name ? ` (${u.name})` : ""}${u.isActive ? "" : " — inativa"}`
        );
      }
      console.log(
        "\nPara repor: bun run recover-access -- --user <username>" +
          "  (+ --reactivate se estiver inativa)"
      );
      return;
    }

    const password = await recoverAccess(prisma, values.user, {
      reactivate: values.reactivate,
    });
    console.log(`\nPalavra-passe temporária para ${values.user}:`);
    console.log(password);
    console.log("\nVai ter de a mudar no primeiro login.");
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exitCode = 1;
  });
}
