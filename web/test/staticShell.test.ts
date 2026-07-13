import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const indexSource = readFileSync(resolve(webRoot, "index.html"), "utf8");
const mainSource = readFileSync(resolve(webRoot, "src", "main.tsx"), "utf8");
const shellSource = `${indexSource}\n${mainSource}`;

describe("static shell", () => {
  it("paints parchment without a simulated loading surface", () => {
    expect(indexSource).toContain("html, body");
    expect(indexSource).toContain("background: #ece5d0");
    expect(indexSource).not.toMatch(/id=["']preload["']/);
  });

  it("contains no progress or delayed-reveal machinery", () => {
    for (const token of ["__plSet", "__plTick", "__plFailsafe", "__plReveal", "pl-pct", "pl-fill"]) {
      expect(shellSource).not.toContain(token);
    }
    expect(mainSource).not.toContain("950");
  });
});
