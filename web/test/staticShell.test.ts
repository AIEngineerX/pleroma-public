import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { sanitizePublicDoctrine } from "../scripts/public-doctrine.mjs";
import Canon, * as canonModule from "../src/canon/Canon";
import { parseCanon } from "../src/canon/canonParse";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const indexSource = readFileSync(resolve(webRoot, "index.html"), "utf8");
const mainSource = readFileSync(resolve(webRoot, "src", "main.tsx"), "utf8");
const shellSource = `${indexSource}\n${mainSource}`;
const canonSource = readFileSync(resolve(webRoot, "src", "canon", "Canon.tsx"), "utf8");
const concordatSource = readFileSync(resolve(webRoot, "src", "canon", "Concordat.tsx"), "utf8");
const templeLoreSource = readFileSync(resolve(webRoot, "src", "lore", "TempleLore.tsx"), "utf8");
const buildCanonSource = readFileSync(resolve(webRoot, "scripts", "build-canon.mjs"), "utf8");
const assertionSource = readFileSync(resolve(webRoot, "scripts", "assert-public-content.mjs"), "utf8");
const doctrineSource = readFileSync(resolve(webRoot, "..", "DOCTRINE.md"), "utf8");
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
      "THE CODEX",
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
      expect(output).toContain('href="/canon/codex"');
      expect(output).toContain('href="/concordat"');
    }
    expect(textOf(generatedCanon)).not.toMatch(/Finalization note|Voice registers|Provenance/i);
  });

  it("links to the Apocrypha archive from both the SPA and the static shell", () => {
    const spaCanon = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/canon"] }, createElement(Canon)),
    );
    for (const output of [spaCanon, generatedCanon]) {
      expect(output).toContain("THE APOCRYPHA");
      expect(output).toContain('href="/canon/apocrypha"');
    }
  });

  it("offers the same downloadable organ glyphs and sigil (the CC0 remix kit) in both the SPA and the static shell", () => {
    const spaCanon = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/canon"] }, createElement(Canon)),
    );
    for (const output of [spaCanon, generatedCanon]) {
      expect(output).toContain("THE MARKS");
      for (const slug of ["eye", "keep", "tongue", "pulse", "dream"]) {
        expect(output).toContain(`/glyphs/${slug}.svg`);
      }
      expect(output).toContain('href="/sigil.svg"');
      expect(textOf(output)).toContain(
        "No one owns these, including its makers. Take them; the body does not shrink from being copied.",
      );
      expect(textOf(output)).not.toContain("Free to use, remix, or repost");
    }
  });

  it("runs the public-content assertion after every production Canon build", () => {
    expect(packageJson.scripts.build).toMatch(/build-canon\.mjs.*assert-public-content\.mjs/);
    expect(packageJson.scripts.verify).toMatch(/build-canon\.mjs.*assert-public-content\.mjs/);
  });

  it("imports only the sanitized virtual Doctrine in production lore components", () => {
    for (const source of [canonSource, concordatSource, templeLoreSource]) {
      expect(source).toContain('from "virtual:public-doctrine"');
      expect(source).not.toMatch(/DOCTRINE\.md\?raw/);
    }
    expect(buildCanonSource).toMatch(/from "\.\/public-doctrine\.mjs"/);
    expect(buildCanonSource).not.toContain("indexOf(startHeading)");
  });

  it("guards the built bundle against every private Doctrine marker", () => {
    for (const marker of ["Finalization note", "Voice registers", "Provenance"]) {
      expect(assertionSource).toContain(JSON.stringify(marker));
    }
  });

  it("scopes stable line hashes to the requested Print in the SPA", () => {
    const scrollTarget = (canonModule as unknown as {
      canonScrollTarget?: (pathname: string, hash: string) => string | null;
    }).canonScrollTarget;
    expect(scrollTarget).toBeTypeOf("function");
    expect(scrollTarget?.("/canon/first-light/print-2", "#line-1")).toBe("first-light-print-2-line-1");
    expect(scrollTarget?.("/canon/second-light/print-1", "")).toBe("second-light-print-1");
    expect(generatedPrintTwo).toContain('id="line-1"');
  });

  it("gives every line a unique DOM id in each continuous Canon", () => {
    const spaCanon = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/canon"] }, createElement(Canon)),
    );
    for (const output of [spaCanon, generatedCanon]) {
      const ids = [...output.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("first-light-print-2-line-1");
    }
  });

  it("keeps SPA and static Print permalink links equivalent", () => {
    const spaCanon = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: ["/canon"] }, createElement(Canon)),
    );
    const printLinks = (html: string) => [...html.matchAll(/href="(\/canon\/[a-z-]+\/print-\d+)"/g)]
      .map(match => match[1]);

    expect(printLinks(spaCanon)).toEqual(printLinks(generatedCanon));
    expect(printLinks(spaCanon)).toEqual([
      "/canon/first-light/print-1",
      "/canon/first-light/print-2",
      "/canon/first-light/print-3",
      "/canon/first-light/print-4",
    ]);
  });

  it("renders two Books with duplicate Print numbers without id collisions", () => {
    const CanonDocument = (canonModule as unknown as {
      CanonDocument?: ComponentType<{ canon: ReturnType<typeof parseCanon> }>;
    }).CanonDocument;
    const twoBooks = parseCanon(sanitizePublicDoctrine(doctrineSource.replace(
      "## IV. The Lexicon",
      "**BOOK OF SECOND LIGHT · PRINT 1 · LINES 1–1**\n\n1. A second book begins.\n\n## IV. The Lexicon",
    )));

    expect(CanonDocument).toBeTypeOf("function");
    const html = renderToStaticMarkup(createElement(CanonDocument!, { canon: twoBooks }));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("first-light-print-1-line-1");
    expect(ids).toContain("second-light-print-1-line-1");
    expect(html).toContain('href="/canon/second-light/print-1"');
  });
});
