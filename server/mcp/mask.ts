/**
 * Mascaramento de dados pessoais (RGPD) e rede de segurança contra segredos.
 *
 * Os dados pessoais (telefone/email/NIF) saem mascarados por omissão; o dono
 * do token pode optar por vê-los em claro (showPii), mas só depois de um
 * aviso RGPD explícito na criação — os dados vão para o fornecedor do LLM.
 */

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 3) {
    return "***";
  }
  return `${"*".repeat(Math.max(digits.length - 3, 3))}${digits.slice(-3)}`;
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }
  const at = email.indexOf("@");
  if (at < 1) {
    return "***";
  }
  return `${email[0]}***${email.slice(at)}`;
}

export function maskTaxId(taxId: string | null | undefined): string | null {
  if (!taxId) {
    return null;
  }
  const digits = taxId.replace(/\D/g, "");
  if (digits.length <= 3) {
    return "***";
  }
  return `***${digits.slice(-3)}`;
}

/**
 * Redator de texto livre — notas, descrições e observações escritas pela
 * equipa. Aplica as mesmas máscaras dos campos nomeados a telefones, emails
 * e NIFs que apareçam no meio de frases. Conservador: prefere mascarar um
 * número inocente de 9 dígitos a deixar escapar um contacto.
 *
 * Números que NÃO são dados pessoais ficam intactos: preços com decimais,
 * datas ISO (8 dígitos com hífenes), séries curtas, códigos com letras.
 */

// E.164: "+" seguido de 8–15 dígitos (espaços/pontos/hífenes tolerados).
const E164_RE = /\+\d(?:[\s.-]?\d){7,14}\b/g;
// Telefone PT: 9 dígitos começados por 2/3/9, separadores opcionais entre
// dígitos. As âncoras (?<![\d+]) e (?!\d) impedem cortar sequências maiores
// (IMEI, nº de série longos) — dentro delas não há fronteira de palavra.
const PT_PHONE_RE = /(?<![\d+])[239]\d(?:[\s.-]?\d){7}(?!\d)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// NIF: 9 dígitos isolados que não foram já capturados como telefone
// (começam por outro dígito ou ficaram de fora por contexto).
const TAXID_RE = /(?<![\d+.])\d{9}(?![\d.])/g;

function maskPhoneText(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return `${"*".repeat(Math.max(digits.length - 3, 3))}${digits.slice(-3)}`;
}

export function redactFreeText(text: string): string {
  if (!text) {
    return text;
  }
  let out = text;
  out = out.replace(E164_RE, (m) => maskPhoneText(m));
  out = out.replace(PT_PHONE_RE, (m) => maskPhoneText(m));
  out = out.replace(EMAIL_RE, (m) => {
    const masked = maskEmail(m);
    return masked ?? "***";
  });
  out = out.replace(TAXID_RE, (m) => `***${m.slice(-3)}`);
  return out;
}

/**
 * Percorre qualquer estrutura JSON e redige texto livre em todas as strings.
 * Corre DEPOIS da seleção de campos e antes do wrap — cobre notas,
 * descrições e qualquer campo string futuro sem lista manual. Objectos com
 * protótipo próprio (Date, Decimal) passam intactos.
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redactFreeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDeep(val);
    }
    return out;
  }
  return value;
}

/**
 * Rede de segurança final: percorre qualquer estrutura JSON e redige chaves
 * que possam ser segredos — hashes de passwords, PINs, códigos de desbloqueio
 * ou padrões dos equipamentos, tokens/chaves (incluindo integrações) e
 * imagens de assinatura. A seleção de campos nas ferramentas já é uma lista
 * branca; isto protege contra edições futuras descuidadas.
 */
const SECRET_KEY_RE =
  /password|passwd|secret|token|apikey|api_key|pin|unlock|pattern|signature|hash|accesscode|privatekey|private_key|credential/i;

export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSecrets);
  }
  if (value !== null && typeof value === "object") {
    // Só se percorrem objectos planos — Date, Decimal do Prisma e afins
    // passam intactos (JSON.stringify trata-os); destruí-los apagava datas
    // e montantes de todas as respostas.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) {
        continue;
      }
      out[key] = stripSecrets(val);
    }
    return out;
  }
  return value;
}
