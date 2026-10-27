/**
 * Picks the base URL the signature QR encodes from /public/access-info.
 *
 * The customer opens the link on their phone over the shop LAN, so the host
 * must be resolvable by any phone OS. Android browsers resolve neither
 * .local mDNS names nor bare machine hostnames — a numeric LAN IPv4 is the
 * only universally reachable option and always wins. When the server has no
 * LAN IPv4, .local stays the next pick (iOS resolves it via Bonjour), then
 * whatever came first.
 */
const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const isNumericIpv4 = (url: string): boolean => {
  try {
    return IPV4_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

export function pickSignBaseUrl(urls: string[]): string | null {
  return (
    urls.find(isNumericIpv4) ??
    urls.find((url) => url.includes(".local")) ??
    urls[0] ??
    null
  );
}
