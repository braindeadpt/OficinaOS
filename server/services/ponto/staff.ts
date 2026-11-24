// Resolve o telefone de origem para um User com pontoEnabled — o
// "funcionário do livro de ponto". Espelha findCustomersByPhone
// (bot-intents.ts): dígitos, prefixo internacional "00" fora, números PT
// (9 dígitos ou 351+12) com fallback de sufixo de 9 dígitos — mas só entre
// candidatos PT, para não confundir fichas estrangeiras com o mesmo
// final. User.phoneE164 é @unique mas o filtro por sufixo corre em memória
// como no matcher de clientes.
//
// Separação dura: um User com pontoEnabled NÃO é cliente para o bot —
// mesmo que exista um Customer com o mesmo telefone, o handler ponto
// corre primeiro (bot-intents.ts) e o telefone nunca chega ao pipeline
// de clientes.

import type { DbClient } from "../../repositories/types.js";

const DIGITS_RE = /\D/g;
const INTL_PREFIX_RE = /^00/;
const PT_CC = "351";

export interface PontoStaffUser {
  externalWork: boolean;
  id: string;
  name: string | null;
  phoneE164: string | null;
  pontoSmsAllowed: boolean;
  username: string;
}

export interface PontoStaffMatch {
  phoneDigits: string;
  user: PontoStaffUser;
}

function ptLike(digits: string): boolean {
  return (
    digits.length === 9 || (digits.startsWith(PT_CC) && digits.length === 12)
  );
}

function digitsOf(phone: string): string {
  return phone.replace(DIGITS_RE, "").replace(INTL_PREFIX_RE, "");
}

export async function findPontoStaff(
  prisma: DbClient,
  fromPhone: string
): Promise<PontoStaffMatch | null> {
  const senderDigits = digitsOf(fromPhone);
  const isPtSender = ptLike(senderDigits);
  const last9 = senderDigits.slice(-9);
  const last4 = senderDigits.slice(-4);
  if ((isPtSender && last9.length < 9) || last4.length < 4) {
    return null;
  }
  const candidates = await prisma.user.findMany({
    select: {
      externalWork: true,
      id: true,
      name: true,
      phoneE164: true,
      pontoSmsAllowed: true,
      username: true,
    },
    where: { phoneE164: { endsWith: last4 }, pontoEnabled: true },
  });
  const match = candidates.find((u) => {
    if (!u.phoneE164) {
      return false;
    }
    const ud = digitsOf(u.phoneE164);
    if (ud === senderDigits) {
      return true;
    }
    return isPtSender && ptLike(ud) && ud.slice(-9) === last9;
  });
  return match ? { phoneDigits: senderDigits, user: match } : null;
}
