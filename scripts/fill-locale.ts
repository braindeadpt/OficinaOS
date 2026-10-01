// Fills locale keys still identical to en.json via Google Translate.
// Usage: bun run scripts/fill-locale.ts <lang>   (e.g. es)
// Re-run is safe — only keys still equal to the English source are attempted.
import fs from "node:fs/promises";
import path from "node:path";

const lang = process.argv[2];
if (!lang) {
  console.error("usage: bun run scripts/fill-locale.ts <lang>");
  process.exit(1);
}

const LOCALES_DIR = path.join(process.cwd(), "src/i18n/locales");
const GOOGLE_TARGET: Record<string, string> = { pt: "pt-PT" };
const DELAY_MS = 120;

type Map = { [key: string]: string | Map };

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function hasIcu(text: string): boolean {
  return text.includes(", plural,") || text.includes(", select,");
}

function placeholdersOk(source: string, target: string): boolean {
  const a = extractPlaceholders(source).sort();
  const b = extractPlaceholders(target).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

async function translate(text: string): Promise<string | null> {
  const tl = GOOGLE_TARGET[lang] ?? lang;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = await res.json();
  const out = data?.[0]?.[0]?.[0];
  return typeof out === "string" && out.length > 0 ? out : null;
}

let done = 0;
let failures = 0;

async function walk(source: Map, target: Map): Promise<void> {
  for (const key in source) {
    const sv = source[key];
    const tv = target[key];
    if (typeof sv === "object" && sv !== null) {
      target[key] = typeof tv === "object" && tv !== null ? tv : ({} as Map);
      await walk(sv as Map, target[key] as Map);
      continue;
    }
    if (typeof tv === "string" && tv !== String(sv)) {
      continue; // already translated
    }
    const src = String(sv);
    if (hasIcu(src)) {
      target[key] = src;
      continue;
    }
    try {
      const tr = await translate(src);
      if (tr) {
        target[key] = placeholdersOk(src, tr) ? tr : src;
      }
    } catch (error) {
      failures += 1;
      process.stderr.write(
        `skip "${key}": ${error instanceof Error ? error.message : error}\n`
      );
      target[key] = src;
      // back off hard on repeated failures (rate limit)
      if (failures > 10) {
        process.stderr.write("too many failures — aborting\n");
        process.exit(2);
      }
    }
    done += 1;
    if (done % 100 === 0) {
      process.stdout.write(`translated ${done}...\n`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}

const en: Map = JSON.parse(
  await fs.readFile(path.join(LOCALES_DIR, "en.json"), "utf-8")
);
const esPath = path.join(LOCALES_DIR, `${lang}.json`);
const target: Map = JSON.parse(await fs.readFile(esPath, "utf-8"));

await walk(en, target);
await fs.writeFile(esPath, `${JSON.stringify(target, null, 2)}\n`, "utf-8");
console.log(`done — attempted ${done}, failures ${failures}`);
