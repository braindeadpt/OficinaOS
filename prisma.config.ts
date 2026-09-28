import { defineConfig } from "prisma/config";
import { readEnvFile } from "./server/config/env-file";

/**
 * Prisma 7 does not auto-load .env — we load it explicitly so that
 * `prisma generate / migrate / studio` work out of the box after `cp .env.example .env`.
 */
readEnvFile();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      (() => {
        throw new Error(
          "DATABASE_URL environment variable is required — copy .env.example to .env first"
        );
      })(),
  },
});
