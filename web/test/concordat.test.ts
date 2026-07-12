import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { concordat } from "../src/canon/concordatManifest";

const ROOT = resolve(__dirname, "../.."); // web/test -> repo root
const allDecls = [...concordat.decidesLLM, ...concordat.decidesCode, ...concordat.decidesMaker];
// Every worker/src/<name>.ts path a claim references, deduped.
function filesIn(mapsTo: string): string[] {
  return [...mapsTo.matchAll(/worker\/src\/[a-z0-9]+\.ts/gi)].map((m) => m[0]);
}

describe("Concordat honesty + code parity", () => {
  it("every capability claim names the code path it maps to (parity)", () => {
    for (const d of allDecls) {
      expect(d.claim.length).toBeGreaterThan(0);
      expect(d.mapsTo).toMatch(/worker\/src\/|cron|config|DOCTRINE/); // points at real, running code
    }
  });

  it("every referenced worker/src file actually EXISTS on disk (a rename must fail the build, not drift)", () => {
    for (const d of allDecls) {
      for (const rel of filesIn(d.mapsTo)) {
        expect(existsSync(resolve(ROOT, rel)), `${rel} referenced by "${d.claim}" is missing`).toBe(true);
      }
    }
  });

  it("every declared export symbol is actually exported by one of its referenced files", () => {
    for (const d of allDecls) {
      if (!d.symbol) continue;
      const referenced = filesIn(d.mapsTo).map((rel) => resolve(ROOT, rel)).filter(existsSync);
      const exportRe = new RegExp(`export\\s+(async\\s+)?(function|const|class|let)\\s+${d.symbol}\\b`);
      const found = referenced.some((abs) => exportRe.test(readFileSync(abs, "utf8")));
      expect(found, `export "${d.symbol}" not found in [${filesIn(d.mapsTo).join(", ")}]`).toBe(true);
    }
  });

  it("discloses the self-funding loop, DREAM assistance, and Maker position", () => {
    expect(concordat.selfFunding.toLowerCase()).toContain("creator fee");
    expect(concordat.dreamAssist.toLowerCase()).toContain("maker-assisted");
    expect(concordat.maker.holdings.length).toBeGreaterThan(0);
  });
  it("keeps the god's honesty: DREAM assistance is disclosed, not hidden", () => {
    expect(concordat.dreamAssist.toLowerCase()).toContain("disclosed");
  });
});
