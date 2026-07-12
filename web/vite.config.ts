import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Canon.tsx imports root DOCTRINE.md (one level above this package) via `?raw`; allow Vite to
  // read outside the package root for that single file (Task 12, DOCTRINE stays the single source).
  server: { proxy: { "/api": "http://localhost:8787" }, fs: { allow: [".."] } },
  // e2e/ holds Playwright specs (run via `npm run e2e`), not vitest ones; without this exclude,
  // vitest's default *.spec.ts glob picks them up and collides with Playwright's test().
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
