import fs from "node:fs/promises";
import path from "node:path";

const LOCALES_DIR = path.join(process.cwd(), "src/i18n/locales");
const EN_PATH = path.join(LOCALES_DIR, "en.json");
const TARGET_LANGS = ["ar", "fr", "pt"];

// Google Translate target codes when they differ from the locale filename
// (e.g. "pt" locale file should translate to European Portuguese, not pt-BR)
const GOOGLE_TARGET_OVERRIDE: Record<string, string> = { pt: "pt-PT" };

interface TranslationMap {
  [key: string]: string | TranslationMap;
}

interface SyncReporter {
  error(message: string): void;
  info(message: string): void;
}

const silentReporter: SyncReporter = {
  error() {
    return undefined;
  },
  info() {
    return undefined;
  },
};

const stdioReporter: SyncReporter = {
  error(message) {
    process.stderr.write(`${message}\n`);
  },
  info(message) {
    process.stdout.write(`${message}\n`);
  },
};

export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function hasComplexIcuSyntax(text: string): boolean {
  return text.includes(", plural,") || text.includes(", select,");
}

function replaceNthPlaceholder(
  target: string,
  placeholder: string,
  replacement: string,
  occurrence: number
): string {
  const token = `{${placeholder}}`;
  let seen = 0;
  let startIndex = 0;

  while (startIndex <= target.length) {
    const index = target.indexOf(token, startIndex);
    if (index === -1) {
      return target;
    }
    if (seen === occurrence) {
      return `${target.slice(0, index)}{${replacement}}${target.slice(index + token.length)}`;
    }
    seen += 1;
    startIndex = index + token.length;
  }

  return target;
}

export function alignPlaceholders(source: string, target: string): string {
  if (hasComplexIcuSyntax(source) || hasComplexIcuSyntax(target)) {
    return target;
  }

  const sourcePlaceholders = extractPlaceholders(source);
  const targetPlaceholders = extractPlaceholders(target);

  if (sourcePlaceholders.length === 0) {
    return target;
  }
  if (targetPlaceholders.length === 0) {
    return source;
  }

  let aligned = target;

  for (const [index, targetPlaceholder] of targetPlaceholders.entries()) {
    const sourcePlaceholder = sourcePlaceholders[index];
    if (!sourcePlaceholder || sourcePlaceholder === targetPlaceholder) {
      continue;
    }
    aligned = replaceNthPlaceholder(
      aligned,
      targetPlaceholder,
      sourcePlaceholder,
      0
    );
  }

  const alignedPlaceholders = extractPlaceholders(aligned).sort();
  const expectedPlaceholders = [...sourcePlaceholders].sort();

  if (
    JSON.stringify(alignedPlaceholders) !== JSON.stringify(expectedPlaceholders)
  ) {
    return source;
  }

  return aligned;
}

async function translateText(
  text: string,
  targetLang: string,
  reporter: SyncReporter = silentReporter
): Promise<string> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (data?.[0]?.[0]?.[0]) {
      return data[0][0][0];
    }
    return text;
  } catch (error) {
    reporter.error(
      `Failed to translate "${text}" to ${targetLang}: ${error instanceof Error ? error.message : String(error)}`
    );
    return text;
  }
}

export async function syncKeys(
  source: TranslationMap,
  target: TranslationMap,
  lang: string,
  reporter: SyncReporter = silentReporter
): Promise<TranslationMap> {
  const newTarget: TranslationMap = {};

  for (const key in source) {
    if (!Object.hasOwn(source, key)) {
      continue;
    }
    const sourceValue = source[key];
    const targetValue = target[key];

    if (typeof sourceValue === "object" && sourceValue !== null) {
      const existingTargetSub =
        typeof targetValue === "object" && targetValue !== null
          ? (targetValue as TranslationMap)
          : {};
      newTarget[key] = await syncKeys(
        sourceValue as TranslationMap,
        existingTargetSub,
        lang,
        reporter
      );
    } else if (typeof targetValue === "string") {
      newTarget[key] = alignPlaceholders(String(sourceValue), targetValue);
    } else {
      reporter.info(`Translating new key: "${key}" for ${lang}...`);
      const translatedValue = await translateText(
        String(sourceValue),
        GOOGLE_TARGET_OVERRIDE[lang] ?? lang,
        reporter
      );
      if (hasComplexIcuSyntax(String(sourceValue))) {
        newTarget[key] = String(sourceValue);
        continue;
      }
      newTarget[key] = alignPlaceholders(String(sourceValue), translatedValue);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return newTarget;
}

async function main() {
  stdioReporter.info("Reading source file (en.json)...");
  const enContent = await fs.readFile(EN_PATH, "utf-8");
  const enJson: TranslationMap = JSON.parse(enContent);

  for (const lang of TARGET_LANGS) {
    const targetPath = path.join(LOCALES_DIR, `${lang}.json`);
    let targetJson: TranslationMap = {};

    try {
      const content = await fs.readFile(targetPath, "utf-8");
      targetJson = JSON.parse(content);
    } catch {
      stdioReporter.info(`${lang}.json not found or invalid, creating new...`);
    }

    stdioReporter.info(`Syncing ${lang}...`);
    const syncedJson = await syncKeys(enJson, targetJson, lang, stdioReporter);

    await fs.writeFile(
      targetPath,
      `${JSON.stringify(syncedJson, null, 2)}\n`,
      "utf-8"
    );
    stdioReporter.info(`Updated ${lang}.json`);
  }

  stdioReporter.info("Done!");
}

main().catch((error) => {
  stdioReporter.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
