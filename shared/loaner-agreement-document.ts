// The loaner agreement is a signed document on its own — separate from the
// intake ficha. The canonical record freezes exactly what the customer saw
// when signing: the clause text (in the language it was shown), the loaned
// unit's identity, the customer and the repair it relates to. The same
// canonicalization runs when the signature session is created, when the
// signature lands and when the stored snapshot is re-checked at print time —
// any drift means the printed agreement must fall back to a paper signature
// line instead of showing a signature that no longer covers the content.

import { canonicalize } from "./intake-document.js";
import { describeLoanerDevice } from "./loaner-description.js";

export const LOANER_AGREEMENT_DOC_KIND = "loaner-agreement";
export const LOANER_AGREEMENT_DOC_VERSION = 1;

export interface LoanerAgreementUnit {
  brand: string | null;
  imei: string | null;
  label: string;
  model: string | null;
}

export interface LoanerAgreementDocument {
  acceptance: string;
  clauses: string[];
  customerName: string;
  customerPhone: string;
  customerTaxId: string | null;
  deviceBrand: string;
  deviceImei: string | null;
  deviceModel: string;
  doc: typeof LOANER_AGREEMENT_DOC_KIND;
  expectedReturn: string | null;
  jobCode: string;
  lentOn: string;
  locale: string;
  note: string | null;
  unit: LoanerAgreementUnit | null;
  v: number;
}

export interface LoanerAgreementText {
  acceptance: string;
  clauses: string[];
  title: string;
}

/** Clause wording per locale — the hashed part of the signed document. */
export const LOANER_AGREEMENT_TEXT: Record<string, LoanerAgreementText> = {
  pt: {
    clauses: [
      "O equipamento acima identificado é propriedade da loja e é cedido ao cliente a título de empréstimo temporário, sem custo, durante o período de reparação do seu equipamento.",
      "O cliente obriga-se a devolver o equipamento no acto da entrega do seu equipamento, em idênticas condições de conservação e funcionamento em que o recebeu.",
      "Em caso de perda, furto, dano ou não devolução, o cliente responsabiliza-se pelo custo de reparação ou substituição do equipamento por outro de características equivalentes.",
      "O equipamento destina-se ao uso exclusivo do cliente, não podendo ser vendido, cedido, emprestado ou dado em garantia a terceiros.",
      "A loja não se responsabiliza por dados, conteúdos ou utilizações registadas no equipamento durante o período de empréstimo.",
    ],
    acceptance: "Li e aceito as condições de empréstimo acima descritas.",
    title: "Termo de Responsabilidade — Equipamento de Empréstimo",
  },
  en: {
    clauses: [
      "The device identified above is the shop's property and is lent to the customer free of charge, for the duration of their own device's repair.",
      "The customer undertakes to return the device when collecting their repaired device, in the same condition and working order as received.",
      "In case of loss, theft, damage or failure to return, the customer is liable for the cost of repair or replacement with a device of equivalent specifications.",
      "The device is for the customer's exclusive use and may not be sold, lent, transferred or pledged to third parties.",
      "The shop is not responsible for any data, content or usage stored on the device during the loan period.",
    ],
    acceptance: "I have read and accept the loan terms described above.",
    title: "Responsibility Agreement — Loaner Device",
  },
  fr: {
    clauses: [
      "L'appareil identifié ci-dessus est la propriété du magasin et est prêté au client gratuitement, pendant la durée de la réparation de son propre appareil.",
      "Le client s'engage à restituer l'appareil lors de la récupération de son appareil réparé, dans le même état de conservation et de fonctionnement que lors de la réception.",
      "En cas de perte, vol, dommage ou non-restitution, le client est responsable du coût de réparation ou de remplacement par un appareil de caractéristiques équivalentes.",
      "L'appareil est réservé à l'usage exclusif du client et ne peut être vendu, prêté, cédé ou donné en garantie à des tiers.",
      "Le magasin n'est pas responsable des données, contenus ou utilisations enregistrés sur l'appareil pendant la durée du prêt.",
    ],
    acceptance:
      "J'ai lu et j'accepte les conditions de prêt décrites ci-dessus.",
    title: "Terme de Responsabilité — Appareil de Prêt",
  },
  es: {
    clauses: [
      "El dispositivo identificado arriba es propiedad de la tienda y se presta al cliente gratuitamente, durante el periodo de reparación de su propio dispositivo.",
      "El cliente se compromete a devolver el dispositivo al recoger su equipo reparado, en las mismas condiciones de conservación y funcionamiento en que lo recibió.",
      "En caso de pérdida, robo, daño o no devolución, el cliente responde por el coste de reparación o sustitución por un dispositivo de características equivalentes.",
      "El dispositivo es para uso exclusivo del cliente y no puede ser vendido, prestado, cedido ni dado en garantía a terceros.",
      "La tienda no se responsabiliza de los datos, contenidos o usos registrados en el dispositivo durante el periodo de préstamo.",
    ],
    acceptance:
      "He leído y acepto las condiciones de préstamo descritas arriba.",
    title: "Termo de Responsabilidad — Dispositivo de Préstamo",
  },
};

export function loanerAgreementText(locale: string): LoanerAgreementText {
  return LOANER_AGREEMENT_TEXT[locale] ?? LOANER_AGREEMENT_TEXT.pt;
}

/** Job row fields the agreement binds to, already joined. */
export interface LoanerAgreementSource {
  createdAt: Date | string;
  customer: { name: string; phone: string; taxId?: string | null };
  device: { brand: { name: string }; model: string };
  estimatedDate?: Date | string | null;
  imei?: string | null;
  jobCode: string;
  loanerDevice?: (Partial<LoanerAgreementUnit> & { label: string }) | null;
  loanerNote?: string | null;
}

const emptyToNull = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

const toIso = (v: Date | string) =>
  typeof v === "string" ? new Date(v).toISOString() : v.toISOString();

/**
 * Builds the canonical agreement from the persisted job — the session
 * snapshot at signing time and the rebuild at attach/print must produce the
 * same bytes, so every field that can appear on paper is part of it.
 */
export function buildLoanerAgreementDocument(
  source: LoanerAgreementSource,
  locale: string
): LoanerAgreementDocument {
  const text = loanerAgreementText(locale);
  const unit = source.loanerDevice;
  return {
    v: LOANER_AGREEMENT_DOC_VERSION,
    doc: LOANER_AGREEMENT_DOC_KIND,
    locale,
    jobCode: source.jobCode,
    customerName: source.customer.name.trim(),
    customerPhone: source.customer.phone.trim(),
    customerTaxId: emptyToNull(source.customer.taxId),
    deviceBrand: source.device.brand.name.trim(),
    deviceModel: source.device.model.trim(),
    deviceImei: emptyToNull(source.imei),
    unit: unit
      ? {
          label: unit.label,
          brand: unit.brand ?? null,
          model: unit.model ?? null,
          imei: unit.imei ?? null,
        }
      : null,
    note: emptyToNull(source.loanerNote),
    lentOn: toIso(source.createdAt),
    expectedReturn: source.estimatedDate ? toIso(source.estimatedDate) : null,
    clauses: [...text.clauses],
    acceptance: text.acceptance,
  };
}

/**
 * True when the job's current data still produces the exact document the
 * customer signed. Any change to a hashed field (unit, note, customer,
 * expected return, locale) makes the stored signature inapplicable — the
 * printed agreement then falls back to the paper signature line.
 */
export function loanerAgreementMatches(
  snapshot: unknown,
  source: LoanerAgreementSource
): boolean {
  const frozen = snapshot as LoanerAgreementDocument | null;
  if (!frozen || frozen.doc !== LOANER_AGREEMENT_DOC_KIND) {
    return false;
  }
  return (
    canonicalize(frozen) ===
    canonicalize(buildLoanerAgreementDocument(source, frozen.locale))
  );
}

/**
 * Public /sign view — same field shape the intake document renders through
 * (so the existing page and the cloud relay display it unchanged) plus a
 * `kind` marker and the structured fields for clients that know them.
 * Contact/identifier fields stay server-side like the intake view.
 */
export function publicLoanerAgreementView(doc: LoanerAgreementDocument) {
  const text = loanerAgreementText(doc.locale);
  const unitLabel = doc.unit
    ? describeLoanerDevice(doc.unit)
    : (doc.note ?? "");
  const repairDevice = [doc.deviceBrand, doc.deviceModel]
    .filter(Boolean)
    .join(" ");
  return {
    kind: doc.doc,
    accessories: [] as string[],
    customerName: doc.customerName,
    deposit: null,
    device: unitLabel,
    estimatedCost: null,
    estimatedDelivery: doc.expectedReturn,
    problem: repairDevice,
    termsText: [
      text.title,
      "",
      ...doc.clauses.map((c, i) => `${i + 1}. ${c}`),
      "",
      doc.acceptance,
    ].join("\n"),
    urgent: false,
    unit: unitLabel,
    repairDevice,
    expectedReturn: doc.expectedReturn,
    clauses: doc.clauses,
    acceptance: doc.acceptance,
    title: text.title,
  };
}
