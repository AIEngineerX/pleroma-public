import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Concordat from "../src/canon/Concordat";

const ROOT = resolve(__dirname, "../.."); // web/test -> repo root
interface ParityDecl { mapsTo: string; symbol?: string }

// Internal source/runtime parity stays test-only. None of these declarations are visitor copy.
const parityDecls: ParityDecl[] = [
  { mapsTo: "worker/src/eye.ts", symbol: "runEyeBatch" },
  { mapsTo: "worker/src/keep.ts", symbol: "runKeep" },
  { mapsTo: "worker/src/tongue.ts, worker/src/rite.ts", symbol: "speakIfDue" },
  { mapsTo: "worker/src/dream.ts", symbol: "composeDream" },
  { mapsTo: "worker/src/moderation.ts", symbol: "moderate" },
  { mapsTo: "worker/src/ratelimit.ts", symbol: "checkRate" },
  { mapsTo: "worker/src/budget.ts", symbol: "reserveEstimate" },
  { mapsTo: "worker/src/eye.ts", symbol: "selectForPerception" },
  { mapsTo: "worker/src/keep.ts", symbol: "selectForKeeping" },
  { mapsTo: "cron in worker/src/index.ts, worker/src/rite.ts, worker/src/lock.ts", symbol: "advanceRite" },
  { mapsTo: "worker/src/pulse.ts", symbol: "nextPulseState" },
  { mapsTo: "worker/src/eye.ts, worker/src/backup.ts", symbol: "sweepQuarantine" },
  { mapsTo: "worker/src/holders.ts", symbol: "reconcileHolders" },
  { mapsTo: "worker/src/dream.ts, worker/src/imagine.ts", symbol: "renderDreams" },
  { mapsTo: "worker/src/env.ts, worker/src/read.ts", symbol: "getState" },
];

// Every worker/src/<name>.ts path a claim references, deduped.
function filesIn(mapsTo: string): string[] {
  return [...mapsTo.matchAll(/worker\/src\/[a-z0-9]+\.ts/gi)].map((m) => m[0]);
}

describe("Concordat honesty + code parity", () => {
  it("keeps production disclosure data out of the visitor bundle", () => {
    const source = readFileSync(resolve(ROOT, "web/src/canon/Concordat.tsx"), "utf8");
    expect(source).not.toMatch(/concordatManifest/);
    expect(existsSync(resolve(ROOT, "web/src/canon/concordatManifest.ts"))).toBe(false);
  });

  it("renders four semantic manuscript folios without technical payloads", () => {
    const html = renderToStaticMarkup(createElement(Concordat));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    expect(text).toMatch(/organs/i);
    expect(text).toMatch(/priests/i);
    expect(text).toMatch(/Maker/i);
    expect(text).toContain("each mark it witnesses");
    expect(text).not.toContain("each offered mark");
    expect(text).not.toMatch(/worker\/src|system prompt|model ID|cron|vendor|JSON/i);
    expect(html.match(/<section/g)).toHaveLength(4);
    expect(html).not.toMatch(/grid-cols/);
  });

  it("the Mark's Path folio states the plain sequence honestly against CURRENT behavior, not an aspirational one", () => {
    const html = renderToStaticMarkup(createElement(Concordat));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    expect(text).toMatch(/mark(?:&#x27;|')s path/i); // React escapes ' to &#x27; in static markup
    expect(text).toContain("A mark is offered at the Threshold. It waits.");
    expect(text).toContain("The Eye witnesses it, usually within minutes.");
    // "judges some of it", not "judges what the Eye has witnessed" -- keep_daily's candidate-list
    // cap means most witnessed marks are never looked at by KEEP at all today, so a claim of
    // universal judgment would violate the Concordat/reality parity invariant until that's fixed.
    expect(text).toContain("judges some of it: kept, or mourned");
    expect(text).toContain("It cannot be undone or repeated.");
    expect(text).not.toMatch(/worker\/src|system prompt|model ID|cron|vendor|JSON|\b12\b/i);
  });

  it("every test-only parity declaration names running code", () => {
    for (const d of parityDecls) {
      expect(d.mapsTo).toMatch(/worker\/src\/|cron/);
    }
  });

  it("every referenced worker/src file actually EXISTS on disk (a rename must fail the build, not drift)", () => {
    for (const d of parityDecls) {
      for (const rel of filesIn(d.mapsTo)) {
        expect(existsSync(resolve(ROOT, rel)), `${rel} referenced by the parity declaration is missing`).toBe(true);
      }
    }
  });

  it("every declared export symbol is actually exported by one of its referenced files", () => {
    for (const d of parityDecls) {
      if (!d.symbol) continue;
      const referenced = filesIn(d.mapsTo).map((rel) => resolve(ROOT, rel)).filter(existsSync);
      const exportRe = new RegExp(`export\\s+(async\\s+)?(function|const|class|let)\\s+${d.symbol}\\b`);
      const found = referenced.some((abs) => exportRe.test(readFileSync(abs, "utf8")));
      expect(found, `export "${d.symbol}" not found in [${filesIn(d.mapsTo).join(", ")}]`).toBe(true);
    }
  });
});
