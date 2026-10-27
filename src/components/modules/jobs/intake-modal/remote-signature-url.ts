/**
 * Picks the base URL a phone should open, from /public/access-info. Used by
 * the remote-signature QR and the /help QR so both always agree.
 *
 * Order:
 * 1. A public HTTPS URL (APP_URL behind a domain or tunnel — Docker/demo
 *    installs). Reachable from any phone, on or off the LAN; a container's
 *    own IPs (172.x) are not.
 * 2. A numeric private LAN IPv4. Android resolves neither .local mDNS names
 *    nor bare machine hostnames, so an IP is the only host every phone
 *    reaches. Loopback (127.x), link-local (169.254.x) and CGNAT/Tailscale
 *    (100.64/10) are never picked — a phone on the shop Wi-Fi can't use them.
 * 3. .local (iOS resolves it via Bonjour).
 * 4. Whatever came first that isn't loopback.
 */
const IPV4_HOST_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function hostOf(url: string): { host: string; protocol: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), protocol: u.protocol };
  } catch {
    return null;
  }
}

function ipv4Octets(host: string): number[] | null {
  const m = IPV4_HOST_RE.exec(host);
  if (!m) {
    return null;
  }
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isPrivateLanIpv4(host: string): boolean {
  const o = ipv4Octets(host);
  if (!o) {
    return false;
  }
  const [a, b] = o;
  return (
    a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  );
}

function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.") ||
    host === "[::1]" ||
    host === "::1"
  );
}

function isPublicHttps(url: string): boolean {
  const h = hostOf(url);
  return (
    h !== null &&
    h.protocol === "https:" &&
    ipv4Octets(h.host) === null &&
    !h.host.endsWith(".local") &&
    !isLoopback(h.host) &&
    h.host.includes(".")
  );
}

export function pickSignBaseUrl(urls: string[]): string | null {
  return (
    urls.find(isPublicHttps) ??
    urls.find((url) => {
      const h = hostOf(url);
      return h !== null && isPrivateLanIpv4(h.host);
    }) ??
    urls.find((url) => hostOf(url)?.host.endsWith(".local")) ??
    urls.find((url) => {
      const h = hostOf(url);
      return h !== null && !isLoopback(h.host);
    }) ??
    null
  );
}

/** Same pick, under the name the /help page reads better with. */
export const pickLanBaseUrl = pickSignBaseUrl;
