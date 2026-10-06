import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@generated": path.resolve(import.meta.dirname, "generated"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // First test in a file builds the Fastify app and cold-imports modules —
    // under parallel load the 5s default flakes (seen in pre-commit runs).
    testTimeout: 15_000,
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "server/**/*.{test,spec}.ts",
      "shared/**/*.{test,spec}.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"],
    },
    setupFiles: ["./vitest.setup.ts"],
  },
});
