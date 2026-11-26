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
