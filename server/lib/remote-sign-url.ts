import {
  ipv4Octets,
  isPublicIpv4Octets,
  isPublicIpv6,
} from "@shared/utils/ip-address";
import { loadEnv } from "../config/env.js";
import { findShopSettingsUnique } from "../repositories/settings.repository.js";
import type { DbClient } from "../repositories/types.js";
import { accessUrls } from "./mdns.js";

const TRAILING_SLASH_RE = /\/+$/;

/**
 * True when a base URL can be opened from a phone outside the shop network.
 * Mirrors isRemoteSignUrl in src/.../remote-signature-url.ts — a public
 * hostname, public IP (v4 or v6) or https tunnel qualifies; LAN IPs,
 * .local names, loopback and CGNAT ranges do not.
 */
function isRemoteUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "[::]"
  ) {
    return false;
  }
  const octets = ipv4Octets(host);
  if (octets) {
    if (!isPublicIpv4Octets(octets)) {
      return false;
    }
  } else if (host.startsWith("[")) {
    // IPv6 literal — brackets are part of URL.hostname, so it would
    // otherwise fall into the bare-hostname rejection below.
    if (!isPublicIpv6(host)) {
      return false;
    }
  } else if (!host.includes(".")) {
    // Bare machine hostnames resolve via NetBIOS/mDNS on the LAN only —
    // they dead-end the moment the phone leaves the shop network.
    return false;
  }
  return true;
}

/**
 * The URL that goes into the message must be the same one the QR encodes:
 * the cloud relay when the session was published there, otherwise a public
 * base the shop exposes itself (trackingBaseUrl first — it is the
 * customer-facing address — then APP_URL from the access-info list).
 * Resolved server-side at session creation so the share/send controls and
 * the send endpoint can never disagree about what is reachable.
 */
export async function resolveRemoteSignUrl(
  prisma: DbClient,
  session: { relayed: boolean; token: string }
): Promise<string | null> {
  const settings = await findShopSettingsUnique(prisma);
  if (session.relayed && settings?.cloudApiUrl) {
    return `${settings.cloudApiUrl.replace(TRAILING_SLASH_RE, "")}/sign/${session.token}`;
  }
  const candidates: string[] = [];
  if (settings?.trackingBaseUrl) {
    candidates.push(settings.trackingBaseUrl);
  }
  const env = loadEnv();
  candidates.push(
    ...accessUrls({
      appUrl: env.APP_URL,
      mdnsHostname: env.MDNS_HOSTNAME,
      port: env.PORT,
    }).urls
  );
  const base = candidates.find(isRemoteUrl);
  return base
    ? `${base.replace(TRAILING_SLASH_RE, "")}/sign/${session.token}`
    : null;
}
