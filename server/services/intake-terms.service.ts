import type { PrismaClient } from "@generated/client";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";

const SUPPORTED = new Set(["en", "es", "fr", "pt"]);

interface TermsBundle {
  intake?: { terms_text?: string };
}
let bundles: Record<string, TermsBundle> | null = null;

async function localeBundles() {
  if (!bundles) {
    const [en, es, fr, pt] = await Promise.all([
      import("../../src/i18n/locales/en.json"),
      import("../../src/i18n/locales/es.json"),
      import("../../src/i18n/locales/fr.json"),
      import("../../src/i18n/locales/pt.json"),
    ]);
    bundles = {
      en: en.default as TermsBundle,
      es: es.default as TermsBundle,
      fr: fr.default as TermsBundle,
      pt: pt.default as TermsBundle,
    };
  }
  return bundles;
}

export function normalizeIntakeLocale(locale: string | null | undefined) {
  const short = locale?.split("-")[0]?.trim().toLowerCase() || "pt";
  return SUPPORTED.has(short) ? short : "pt";
}

export interface ResolvedIntakeTerms {
  locale: string;
  text: string;
  updatedAt: Date | null;
  version: number;
}

/**
 * The legal text is server-resolved, never client-supplied: a forged payload
 * cannot put different clauses under a customer signature. Custom shop terms
 * win; otherwise the exact bundled UI translation for the signing locale is
 * used, so staff and customer still read the same text.
 */
export async function resolveIntakeTerms(
  prisma: PrismaClient,
  locale: string | null | undefined
): Promise<ResolvedIntakeTerms> {
  const normalizedLocale = normalizeIntakeLocale(locale);
  const settings = await findShopSettingsUnique(prisma);
  const custom = settings?.intakeTerms?.trim();
  const fallback = (await localeBundles())[normalizedLocale]?.intake
    ?.terms_text;
  const text = custom || fallback;
  if (!text) {
    throw new Error("intake terms translation missing");
  }
  return {
    locale: normalizedLocale,
    text,
    updatedAt: settings?.intakeTermsUpdatedAt ?? null,
    version: settings?.intakeTermsVersion ?? 1,
  };
}
