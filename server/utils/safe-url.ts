// Fetch de URLs controladas por terceiros (ex.: url de foto vinda do
// webhook Evolution/Meta) — guarda SSRF: só https para hosts públicos
// (IPs privados/loopback/link-local rejeitados e o DNS tem de resolver
// só para endereços públicos), ou a origem exata do serviço configurado
// (a instância Evolution na LAN já é confiada — o apikey vai lá na
// mesma). Redirects seguidos à mão (máx. 3): cada salto volta a passar
// pela validação — um 302 para http://169.254.169.254 não contorna a
// regra. O corpo é lido com limite para uma URL hostil não encher a
// memória.
//
// Limite conhecido: a resolução DNS e o fetch são dois passos — um
// atacante com DNS próprio pode tentar rebinding (resolver público no
// check e privado no connect). Fechar isso por completo exige ligar ao
// IP validado; para a superfície aqui (webhook com token, loja na LAN)
// a verificação + redirect manual é a profundidade certa.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
/** Teto do corpo — as fotos de ponto validam 5 MB a jusante. */
export const SAFE_URL_MAX_BYTES = 6 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HOSTNAME_TRAILING_DOT_RE = /\.$/;
const V6_MAPPED_RE = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const V4_TAIL_RE = /(\d{1,3}(?:\.\d{1,3}){3})$/;
const TRAILING_COLON_RE = /:$/;
const HEXTET_RE = /^[0-9a-f]{1,4}$/;
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".localdomain",
];

function isPrivateIpv4Octets(o: number[]): boolean {
  const [a, b, c] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local (metadata cloud)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmark 198.18/15
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast + reservado
  );
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  return (
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    isPrivateIpv4Octets(octets)
  );
}

/** Expande IPv6 comprimido em 8 hextets; null se o formato não é IPv6. */
function ipv6Hextets(host: string): number[] | null {
  let s = host.toLowerCase();
  if (s.includes("%")) {
    return null; // zone id ("fe80::1%eth0") — não é IPv6 puro
  }
  // Sufixo IPv4 embutido ("::ffff:127.0.0.1") — conta como 2 hextets.
  let v4Tail: number[] = [];
  const v4 = V4_TAIL_RE.exec(s);
  if (v4) {
    const parts = v4[1].split(".").map(Number);
    if (parts.some((n) => n > 255)) {
      return null;
    }
    v4Tail = [parts[0] * 256 + parts[1], parts[2] * 256 + parts[3]];
    s = s.slice(0, -v4[1].length).replace(TRAILING_COLON_RE, "");
  }
  const halves = s.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parse = (part: string): number[] =>
    part === ""
      ? []
      : part
          .split(":")
          .map((h) =>
            HEXTET_RE.test(h) ? Number.parseInt(h, 16) : Number.NaN
          );
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const middle =
    halves.length === 2 ? 8 - head.length - tail.length - v4Tail.length : 0;
  if (
    middle < 0 ||
    (halves.length === 1 && head.length + v4Tail.length !== 8)
  ) {
    return null;
  }
  const groups = [
    ...head,
    ...new Array<number>(Math.max(middle, 0)).fill(0),
    ...tail,
    ...v4Tail,
  ];
  if (groups.length !== 8 || groups.some(Number.isNaN)) {
    return null;
  }
  return groups;
}

/** Octetos do IPv4 embutido nos hextets 6–7 (mapped/NAT64). */
function ipv4FromHextets(g6: number, g7: number): number[] {
  return [Math.floor(g6 / 256), g6 % 256, Math.floor(g7 / 256), g7 % 256];
}

function isPrivateIpv6(host: string): boolean {
  const h = ipv6Hextets(host);
  if (!h) {
    return true; // formato não provado → bloqueia
  }
  const g0 = h[0];
  const g1 = h[1];
  const g5 = h[5];
  const g6 = h[6];
  const g7 = h[7];
  if (h.every((x) => x === 0)) {
    return true; // ::
  }
  if (h.slice(0, 7).every((x) => x === 0) && g7 === 1) {
    return true; // ::1
  }
  // Range checks em aritmética (sem bitwise): /7 e /10 do primeiro
  // hextet, /8 do primeiro byte.
  if (g0 >= 0xfc_00 && g0 <= 0xfd_ff) {
    return true; // fc00::/7 ULA
  }
  if (g0 >= 0xfe_80 && g0 <= 0xfe_bf) {
    return true; // fe80::/10 link-local
  }
  if (g0 >= 0xff_00) {
    return true; // ff00::/8 multicast
  }
  // ::ffff:a.b.c.d (mapped) e 64:ff9b::/96 (NAT64) embutem IPv4 — a
  // decisão fica com os mesmos ranges do IPv4.
  if (h.slice(0, 5).every((x) => x === 0) && g5 === 0xff_ff) {
    return isPrivateIpv4Octets(ipv4FromHextets(g6, g7));
  }
  if (g0 === 0x00_64 && g1 === 0xff_9b) {
    // O /96 exige o meio (hextets 2–5) a zero; fora dessa forma é
    // espaço não alocado — bloqueia por precaução.
    if (h.slice(2, 6).every((x) => x === 0)) {
      return isPrivateIpv4Octets(ipv4FromHextets(g6, g7));
    }
    return true;
  }
  // 2002::/16 (6to4) e 2001::/32 (Teredo) embutem IPv4 — conservador:
  // não vale a pena provar o endereço final para um fetch de foto.
  if (g0 === 0x20_02 || (g0 === 0x20_01 && g1 === 0)) {
    return true;
  }
  return false;
}

/** IP literal privado/reservado? (hostname ≠ IP — verificado à parte). */
export function isPrivateIpLiteral(host: string): boolean {
  const bare =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(bare) === 4) {
    return isPrivateIpv4(bare);
  }
  if (isIP(bare) === 6) {
    return isPrivateIpv6(bare);
  }
  // IPv4-mapped em forma dotted que o URL não normalizou.
  const mapped = V6_MAPPED_RE.exec(bare);
  if (mapped) {
    return isPrivateIpv4(mapped[1]);
  }
  return false;
}

/** Hostname que nunca deve ser contactado por nome (loopback/local). */
function isBlockedHostname(host: string): boolean {
  const bare = host.toLowerCase().replace(HOSTNAME_TRAILING_DOT_RE, "");
  return (
    BLOCKED_HOSTNAMES.has(bare) ||
    BLOCKED_HOST_SUFFIXES.some((s) => bare.endsWith(s))
  );
}

/** A URL pertence à origem confiável declarada (serviço LAN)? */
function isTrustedOrigin(
  url: URL,
  trustedOrigin: string | null | undefined
): boolean {
  if (!trustedOrigin) {
    return false;
  }
  try {
    return url.origin === new URL(trustedOrigin).origin;
  } catch {
    return false; // trustedOrigin inválida — validação normal
  }
}

/** DNS: a hostname resolve (e todos os endereços) só para IPs públicos. */
async function resolvesToPublicIps(hostname: string): Promise<boolean> {
  try {
    const addrs = await lookup(hostname, { all: true, verbatim: true });
    return (
      addrs.length > 0 &&
      addrs.every((a) =>
        isIP(a.address) === 4
          ? !isPrivateIpv4(a.address)
          : !isPrivateIpv6(a.address)
      )
    );
  } catch {
    return false; // DNS falhou — não há como provar que é público
  }
}

/**
 * A URL é contactável? Regras:
 * - só http/https;
 * - http só na origem confiável declarada (serviço LAN configurado);
 * - host público: IP literal tem de ser público; hostname tem de
 *   resolver (DNS) apenas para endereços públicos.
 */
async function checkUrl(
  rawUrl: string,
  trustedOrigin: string | null | undefined
): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (isTrustedOrigin(url, trustedOrigin)) {
    return url;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  const bare = url.hostname.startsWith("[")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const kind = isIP(bare);
  if (kind !== 0) {
    const privateHit = kind === 4 ? isPrivateIpv4(bare) : isPrivateIpv6(bare);
    return privateHit ? null : url;
  }
  if (isBlockedHostname(url.hostname)) {
    return null;
  }
  return (await resolvesToPublicIps(url.hostname)) ? url : null;
}

/** Corpo com limite — null se exceder maxBytes (ou não houver corpo). */
async function readBodyCapped(
  res: Response,
  maxBytes: number
): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null;
  }
  if (!res.body) {
    return Buffer.alloc(0);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string | null;
}

/**
 * GET com guarda SSRF. `trustedOrigin` isenta a origem configurada (a
 * instância Evolution na LAN); fora dela só https público. Devolve
 * null em qualquer falha — o chamador decide o fallback.
 */
export async function fetchPublicMedia(
  rawUrl: string,
  opts: { maxBytes?: number; trustedOrigin?: string | null } = {}
): Promise<SafeFetchResult | null> {
  const maxBytes = opts.maxBytes ?? SAFE_URL_MAX_BYTES;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkUrl(current, opts.trustedOrigin);
    if (!url) {
      return null;
    }
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => null);
    if (!res) {
      return null;
    }
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      if (!location) {
        return null;
      }
      try {
        current = new URL(location, url).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) {
      return null;
    }
    const buffer = await readBodyCapped(res, maxBytes);
    if (!buffer) {
      return null;
    }
    return { buffer, contentType: res.headers.get("content-type") };
  }
  return null;
}
