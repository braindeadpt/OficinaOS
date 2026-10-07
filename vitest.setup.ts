import "@testing-library/jest-dom/vitest";

// Node ≥22 exposes a global `localStorage` getter that returns undefined
// unless --localstorage-file is passed. Vitest's jsdom env can't overwrite
// it, so DOM tests see `localStorage === undefined`. Shim an in-memory
// Storage whenever the real one is missing.
if (typeof globalThis.localStorage === "undefined") {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (k: string) => (data.has(k) ? (data.get(k) ?? null) : null),
      key: (i: number) => [...data.keys()][i] ?? null,
      removeItem: (k: string) => void data.delete(k),
      setItem: (k: string, v: string) => void data.set(k, String(v)),
    },
  });
}

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-thirty-two-chars-long";
process.env.AI_ENCRYPTION_KEY ??= "test-aes-key-at-least-thirty-two-chars-ok";

// Keep tests hermetic: a stray PORT/HOST exported by the host shell can
// otherwise fail env validation inside unit tests that never open a socket.
if (!Number.parseInt(process.env.PORT ?? "", 10)) {
  process.env.PORT = "4000";
}
if (!process.env.HOST) {
  process.env.HOST = "127.0.0.1";
}
