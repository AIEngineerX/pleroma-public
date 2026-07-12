import { execFileSync } from "node:child_process";
// Regenerate doctrine.generated.ts before the run, so a DOCTRINE.md edit is always reflected even if
// someone runs vitest directly instead of via the npm script.
export default function () {
  execFileSync(process.execPath, ["scripts/compile-doctrine.mjs"], { stdio: "inherit" });
}
