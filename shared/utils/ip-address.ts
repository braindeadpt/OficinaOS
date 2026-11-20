const IPV4_HOST_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_V4_TAIL_RE = /(\d{1,3}(?:\.\d{1,3}){3})$/;
const HEXTET_RE = /^[0-9a-f]{1,4}$/;

/** Dotted-quad host → octets, or null when the host is not IPv4. */
export function ipv4Octets(host: string): number[] | null {
  const m = IPV4_HOST_RE.exec(host);
  if (!m) {
    return null;
  }
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

/**
 * False for addresses no phone off the LAN can dial: 0/8, 10/8, 127/8,
 * 169.254/16 (link-local), 172.16/12, 192.168/16 and 100.64/10 (CGNAT).
 */
export function isPublicIpv4Octets(octets: number[]): boolean {
  const [a, b] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Expands a bracketed IPv6 literal ("[2606:4700::1111]") into its 8
 * hextets. Handles "::" compression, a zone id and an embedded
 * dotted-quad tail (::ffff:192.0.2.1). Returns null for anything that is
 * not a literal.
 */
export function ipv6Hextets(host: string): number[] | null {
  if (!(host.startsWith("[") && host.endsWith("]"))) {
    return null;
  }
  let inner = (host.slice(1, -1).split("%")[0] ?? "").toLowerCase();
  // An embedded IPv4 tail occupies the last two hextets — strip it first.
  const v4Match = IPV6_V4_TAIL_RE.exec(inner);
  let v4Hextets: number[] = [];
  if (v4Match) {
    const octets = v4Match[1].split(".").map(Number);
    if (octets.some((o) => o > 255)) {
      return null;
    }
    v4Hextets = [octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]];
    inner = inner.slice(0, -v4Match[1].length);
    if (inner.endsWith(":")) {
      inner = inner.slice(0, -1);
    }
  }
  const halves = inner.split("::");
  if (halves.length > 2) {
    return null;
  }
  const toHextets = (s: string): number[] | null => {
    if (s === "") {
      return [];
    }
    const parts = s.split(":");
    if (parts.some((g) => !HEXTET_RE.test(g))) {
      return null;
    }
    return parts.map((g) => Number.parseInt(g, 16));
  };
  const head = toHextets(halves[0] ?? "");
  const tail = halves.length === 2 ? toHextets(halves[1] ?? "") : [];
  if (head === null || tail === null) {
    return null;
  }
  const body = [...head, ...tail];
  const missing = 8 - body.length - v4Hextets.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }
  const hextets =
    halves.length === 2
      ? [...head, ...new Array<number>(missing).fill(0), ...tail, ...v4Hextets]
      : [...body, ...v4Hextets];
  return hextets.length === 8 ? hextets : null;
}

/**
 * True only for a globally routable IPv6 literal. Loopback (::1), the
 * unspecified address (::), link-local (fe80::/10), unique-local
 * (fc00::/7), deprecated site-local (fec0::/10) and multicast (ff00::/8)
 * stay LAN-side; IPv4-mapped/compatible forms are judged by the embedded
 * IPv4's own private-range rules.
 */
export function isPublicIpv6(host: string): boolean {
  const h = ipv6Hextets(host);
  if (!h) {
    return false;
  }
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible) embed an IPv4 —
  // the last two hextets ARE that address, so apply the IPv4 rules.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0 || h[5] === 0xff_ff)) {
    return isPublicIpv4Octets([Math.floor(h[6] / 256), h[6] % 256]);
  }
  const first = h[0];
  if (first >= 0xfe_80 && first <= 0xfe_bf) {
    return false; // fe80::/10 link-local
  }
  if (first >= 0xfc_00 && first <= 0xfd_ff) {
    return false; // fc00::/7 unique-local
  }
  if (first >= 0xfe_c0 && first <= 0xfe_ff) {
    return false; // fec0::/10 site-local (deprecated)
  }
  if (first >= 0xff_00) {
    return false; // ff00::/8 multicast
  }
  return true;
}
