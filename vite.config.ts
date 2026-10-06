import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
      "@generated": path.resolve(__dirname, "./generated"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        timeout: 30000,
      },
      "/ws": {
        target: "ws://localhost:4000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const match = id.match(/node_modules\/([^/]+)/);
          if (!match) return;
          const pkg = match[1].startsWith("@") ? id.match(/node_modules\/(@[^/]+\/[^/]+)/)?.[1] : match[1];
          if (!pkg) return;
          const chunks: Record<string, string[]> = {
            "vendor-react": ["react", "react-dom", "react-router"],
            "vendor-ui": ["sonner"],
            "vendor-i18n": ["i18next", "react-i18next", "i18next-browser-languagedetector"],
            "vendor-auth": ["better-auth"],
          };
          for (const [chunk, packages] of Object.entries(chunks)) {
            if (packages.some((p) => pkg === p)) return chunk;
          }
        },
      },
    },
  },
});
