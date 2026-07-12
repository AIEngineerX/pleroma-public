// Reads the single source of truth (root DOCTRINE.md) and emits a plain TS module exporting its raw
// text, so the deployed Worker (esbuild, no ?raw loader) and the vitest harness import doctrine the
// same way. Run before every build/test; the output is gitignored and regenerated, so it cannot drift.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../DOCTRINE.md");         // worker/scripts -> repo root
const out = resolve(here, "../src/doctrine.generated.ts");
const md = readFileSync(src, "utf8");
const body = "export const DOCTRINE_MD = " + JSON.stringify(md) + ";\n";
writeFileSync(out, "// GENERATED from DOCTRINE.md by scripts/compile-doctrine.mjs. Do not edit.\n" + body);
console.log(`compiled DOCTRINE.md -> src/doctrine.generated.ts (${md.length} chars)`);
