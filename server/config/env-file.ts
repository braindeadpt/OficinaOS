import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader (KEY=VALUE lines, # comments, optional quotes).
 * Used by tooling that runs before the server (prisma.config.ts, seed).
 * The server itself relies on Bun's automatic .env loading.
 */
export function readEnvFile(filePath = ".env"): Record<string, string> {
  const abs = resolve(process.cwd(), filePath);
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return {}; // no .env — caller's error handling takes over
  }

  const vars: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
    vars[key] = value;
  }
  return vars;
}
