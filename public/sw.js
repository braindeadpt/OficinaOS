// OficinaOS service worker — PWA installability + resilient shell.
// Registered only in production builds over a secure context (HTTPS);
// plain-HTTP LAN installs never see it, so there is no stale-cache risk
// on the most common deployment path.
const CACHE = "oficinaos-v1";
// Content-hashed assets accumulate across deploys — cap the cache so
// storage can't grow without bound.
const MAX_CACHE_ENTRIES = 150;

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHE_ENTRIES;
  for (const key of keys.slice(0, Math.max(0, excess))) {
    await cache.delete(key);
  }
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) {
    return hit;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone()).then(() => trimCache(cache));
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone()).then(() => trimCache(cache));
    }
    return response;
  } catch {
    const hit = await caches.match(request);
    if (hit) {
      return hit;
    }
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  // API calls always go to the network — never cached, never intercepted.
  if (url.pathname.startsWith("/api/")) {
    return;
  }
  // Vite emits content-hashed assets — immutable, safe to cache forever.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  // Navigations: network-first so deploys propagate immediately,
  // falling back to the cached shell if the server is briefly down.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});
