import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sanitizePublicDoctrine } from "./scripts/public-doctrine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const doctrinePath = resolve(here, "../DOCTRINE.md");
const virtualDoctrineId = "virtual:public-doctrine";
const resolvedVirtualDoctrineId = `\0${virtualDoctrineId}`;

function publicDoctrine(): Plugin {
  return {
    name: "public-doctrine",
    resolveId(id) {
      return id === virtualDoctrineId ? resolvedVirtualDoctrineId : null;
    },
    load(id) {
      if (id !== resolvedVirtualDoctrineId) return null;
      this.addWatchFile(doctrinePath);
      const source = sanitizePublicDoctrine(readFileSync(doctrinePath, "utf8"));
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export default defineConfig({
  plugins: [publicDoctrine(), react(), tailwindcss()],
  server: { proxy: { "/api": "http://localhost:8787" } },
  // e2e/ and scripts/fixtures/ hold Playwright specs (run via `npm run e2e` and the ownership
  // suites), not vitest ones; without this exclude, vitest's default *.spec.ts glob picks them
  // up and collides with Playwright's test().
  test: { exclude: [...configDefaults.exclude, "e2e/**", "scripts/fixtures/**"] },
});
