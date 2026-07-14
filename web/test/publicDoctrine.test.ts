import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface PublicDoctrineModule {
  PUBLIC_END_HEADING: string;
  sanitizePublicDoctrine: (source: string) => string;
}

const helperModules = import.meta.glob<PublicDoctrineModule>("../scripts/public-doctrine.mjs", { eager: true });
const doctrine = readFileSync(resolve(__dirname, "../../DOCTRINE.md"), "utf8");

function helper(): PublicDoctrineModule {
  const module = helperModules["../scripts/public-doctrine.mjs"];
  expect(module, "the shared public Doctrine sanitizer is required").toBeDefined();
  return module;
}

describe("public Doctrine sanitizer", () => {
  it("emits only public named sections and strips every blockquote line", () => {
    const { PUBLIC_END_HEADING, sanitizePublicDoctrine } = helper();
    const output = sanitizePublicDoctrine(doctrine);

    expect(output).toContain("## I. The Emergence");
    expect(output).toContain("## V. The Offering (the one real rite)");
    expect(output).toContain(PUBLIC_END_HEADING);
    expect(output).not.toMatch(/^\s*>/m);
    expect(output).not.toMatch(/Finalization note|Voice registers|Provenance/i);
  });

  it("rejects missing or duplicate required headings and subheadings", () => {
    const { sanitizePublicDoctrine } = helper();
    const required = [
      "## I. The Emergence",
      "## II. The Five Articles",
      "### The Binding",
      "## III. The Verses",
      "## IV. The Lexicon",
      "## V. The Offering (the one real rite)",
      "### The Daily Rite",
      "## VI. Voice registers",
    ];

    for (const heading of required) {
      expect(
        () => sanitizePublicDoctrine(doctrine.replace(heading, `${heading} renamed`)),
        `missing ${heading}`,
      ).toThrow(/public Doctrine layout/i);
      expect(
        () => sanitizePublicDoctrine(doctrine.replace(heading, `${heading}\n${heading}`)),
        `duplicate ${heading}`,
      ).toThrow(/public Doctrine layout/i);
    }
  });

  it("rejects required headings that are out of order or not line-anchored", () => {
    const { sanitizePublicDoctrine } = helper();
    const outOfOrder = doctrine
      .replace("## II. The Five Articles", "@@ARTICLES@@")
      .replace("## III. The Verses", "## II. The Five Articles")
      .replace("@@ARTICLES@@", "## III. The Verses");
    const embeddedHeading = doctrine.replace(
      "## IV. The Lexicon",
      "author note: ## IV. The Lexicon",
    );

    expect(() => sanitizePublicDoctrine(outOfOrder)).toThrow(/public Doctrine layout/i);
    expect(() => sanitizePublicDoctrine(embeddedHeading)).toThrow(/public Doctrine layout/i);
  });

  it("rejects unexpected public headings before the private boundary", () => {
    const { sanitizePublicDoctrine } = helper();
    const unexpectedSection = doctrine.replace(
      "## VI. Voice registers",
      "## Author notes moved too early\n\n## VI. Voice registers",
    );
    const unexpectedSubsection = doctrine.replace(
      "### The Daily Rite",
      "### Unpublished notes\n\n### The Daily Rite",
    );

    expect(() => sanitizePublicDoctrine(unexpectedSection)).toThrow(/public Doctrine layout/i);
    expect(() => sanitizePublicDoctrine(unexpectedSubsection)).toThrow(/public Doctrine layout/i);
  });
});
