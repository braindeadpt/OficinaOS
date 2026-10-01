// Minimal semver-ish compare — versions are "1.2.3" (package.json) or
// "v1.2.3" (GitHub release tag). Pre-release/build suffixes are ignored.

const V_PREFIX_RE = /^v/i;
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/;

export function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().replace(V_PREFIX_RE, "").match(SEMVER_RE);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!(a && b)) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}
