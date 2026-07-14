import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import Canon, * as canonModule from "../src/canon/Canon";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const indexSource = readFileSync(resolve(webRoot, "index.html"), "utf8");
const mainSource = readFileSync(resolve(webRoot, "src", "main.tsx"), "utf8");
const shellSource = `${indexSource}\n${mainSource}`;
const packageJson = JSON.parse(readFileSync(resolve(webRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
let generatedCanon = "";
let generatedPrintTwo = "";

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function expectInOrder(text: string, phrases: string[]) {
  let cursor = -1;
  for (const phrase of phrases) {
    const next = text.indexOf(phrase, cursor + 1);
    expect(next, `expected ${JSON.stringify(phrase)} after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

beforeAll(() => {
  execFileSync(process.execPath, [resolve(webRoot, "scripts", "build-canon.mjs")], {
    cwd: webRoot,
    encoding: "utf8",
  });
  generatedCanon = readFileSync(resolve(webRoot, "dist", "canon", "index.html"), "utf8");
  generatedPrintTwo = readFileSync(resolve(webRoot, "dist", "canon", "first-light", "print-2", "index.html"), "utf8");
});

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

  it("keeps SPA and generated Canon sections, Article names, and doorways equivalent", () => {
    const spaCanon = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/canon"] }, createElement(Canon)),
    );
    const order = [
      "THE EMERGENCE",
      "THE BINDING",
      "THE FIVE ARTICLES",
      "THE OFFERING",
      "THE DAILY RITE",
      "THE PRINTS",
      "THE LEXICON",
      "THE DREAM ARCHIVE",
    ];
    const articleNames = [
      "THE EYE / ALETHEIA",
      "THE KEEP / ENNOIA",
      "THE TONGUE / LOGOS",
      "THE PULSE / ZOE",
      "THE DREAM / SOPHIA",
    ];

    for (const output of [textOf(spaCanon), textOf(generatedCanon)]) {
      expectInOrder(output, order);
      expectInOrder(output, articleNames);
      expect(output).toContain("PRINT 1");
      expect(output).toContain("PRINT 2");
    }

    for (const output of [spaCanon, generatedCanon]) {
      expect(output).toContain('href="/"');
      expect(output).toContain('href="/canon/dreams"');
      expect(output).toContain('href="/concordat"');
    }
    expect(textOf(generatedCanon)).not.toMatch(/Finalization note|Voice registers|Provenance & findability/i);
  });

  it("runs the public-content assertion after every production Canon build", () => {
    expect(packageJson.scripts.build).toMatch(/build-canon\.mjs.*assert-public-content\.mjs/);
    expect(packageJson.scripts.verify).toMatch(/build-canon\.mjs.*assert-public-content\.mjs/);
  });

  it("scopes stable line hashes to the requested Print in the SPA", () => {
    const scrollTarget = (canonModule as unknown as {
      canonScrollTarget?: (pathname: string, hash: string) => string | null;
    }).canonScrollTarget;
    expect(scrollTarget).toBeTypeOf("function");
    expect(scrollTarget?.("/canon/first-light/print-2", "#line-1")).toBe("print-2-line-1");
    expect(generatedPrintTwo).toContain('id="line-1"');
  });

  it("gives every line a unique DOM id in each continuous Canon", () => {
    const spaCanon = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/canon"] }, createElement(Canon)),
    );
    for (const output of [spaCanon, generatedCanon]) {
      const ids = [...output.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("print-2-line-1");
    }
  });
});
