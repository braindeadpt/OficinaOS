import "@testing-library/jest-dom/vitest";

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
