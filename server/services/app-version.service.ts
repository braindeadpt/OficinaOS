import pkg from "../../package.json";
import { isNewerVersion } from "../utils/version.js";

// The app phones home to GitHub Releases at most once a day. A failed check
// (shop offline — internet is only needed for install/updates) retries after
// an hour instead of pinning "unknown" for a whole day.
const RELEASES_API =
  "https://api.github.com/repos/braindeadpt/OficinaOS/releases/latest";
const OK_TTL_MS = 24 * 60 * 60 * 1000;
const ERR_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface LatestCache {
  checkedAt: number;
  latest: string | null;
  releaseUrl: string | null;
  ttl: number;
}

const V_PREFIX_RE = /^v/i;

let cache: LatestCache | null = null;

export interface AppVersionInfo {
  checkedAt: string | null;
  current: string;
  latest: string | null;
  releaseUrl: string | null;
  updateAvailable: boolean;
}

export async function getAppVersionInfo(
  fetchImpl: typeof fetch = fetch
): Promise<AppVersionInfo> {
  if (!cache || Date.now() - cache.checkedAt > cache.ttl) {
    cache = await fetchLatestRelease(fetchImpl);
  }
  const { latest } = cache;
  return {
    current: pkg.version,
    latest,
    updateAvailable: latest !== null && isNewerVersion(latest, pkg.version),
    releaseUrl: cache.releaseUrl,
    checkedAt: latest === null ? null : new Date(cache.checkedAt).toISOString(),
  };
}

// Tests stub the cache through this instead of waiting on TTLs.
export function resetAppVersionCache(): void {
  cache = null;
}

async function fetchLatestRelease(
  fetchImpl: typeof fetch
): Promise<LatestCache> {
  try {
    const res = await fetchImpl(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "oficinaos-update-check",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`);
    }
    const data = (await res.json()) as {
      html_url?: string;
      tag_name?: string;
    };
    return {
      latest:
        typeof data.tag_name === "string"
          ? data.tag_name.replace(V_PREFIX_RE, "")
          : null,
      releaseUrl: typeof data.html_url === "string" ? data.html_url : null,
      checkedAt: Date.now(),
      ttl: OK_TTL_MS,
    };
  } catch {
    return {
      latest: null,
      releaseUrl: null,
      checkedAt: Date.now(),
      ttl: ERR_TTL_MS,
    };
  }
}
