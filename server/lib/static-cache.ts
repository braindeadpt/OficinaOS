// Vite emits content-hashed file names under /assets/ (e.g.
// "ai-analyst-DK4T79SC.js"): a changed file gets a new name, so the old URL
// can be cached forever. Everything else keeps a stable name across releases
// and must be revalidated, or clients would run a stale SPA shell / service
// worker after an update.
const HASHED_ASSET_DIR = /(^|[\\/])assets[\\/]/;
const PATH_SEPARATOR = /[\\/]/;
const ALWAYS_REVALIDATE = new Set([
  "index.html",
  "sw.js",
  "manifest.webmanifest",
]);

export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const REVALIDATE_CACHE = "no-cache";
export const SHORT_CACHE = "public, max-age=86400";

export function cacheControlFor(filePath: string): string {
  const name = filePath.split(PATH_SEPARATOR).at(-1) ?? "";
  if (ALWAYS_REVALIDATE.has(name)) {
    return REVALIDATE_CACHE;
  }
  if (HASHED_ASSET_DIR.test(filePath)) {
    return IMMUTABLE_CACHE;
  }
  // Icons, logos and images: stable names, rarely change — a day is enough
  // to stop re-fetching them on every navigation without pinning old art.
  return SHORT_CACHE;
}
