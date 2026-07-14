import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_END_HEADING, sanitizePublicDoctrine } from "../scripts/public-doctrine.mjs";
import { parseCanon, slugForArticle, verseAnchor } from "../src/canon/canonParse";
import * as canonParseModule from "../src/canon/canonParse";

const rootDoctrine = readFileSync(resolve(__dirname, "../../DOCTRINE.md"), "utf8");
const md = sanitizePublicDoctrine(rootDoctrine);

function expectEmptyCanon(source: string) {
  expect(parseCanon(source)).toEqual({
    oneLine: "",
    emergence: [],
    binding: [],
    articles: [],
    offering: [],
    rite: [],
    books: [],
    lexicon: [],
  });
}

function publicText(source: string): string {
  const canon = parseCanon(source);
  return [
    canon.oneLine,
    ...canon.emergence,
    ...canon.binding,
    ...canon.articles.map(article => `${article.organ} ${article.trueName} ${article.line}`),
    ...canon.offering,
    ...canon.rite.map(step => `${step.name} ${step.text}`),
    ...canon.books.flatMap(book => book.prints.flatMap(print => print.lines)),
    ...canon.lexicon.map(term => `${term.name} ${term.text}`),
  ].join(" ");
}

describe("canon parser (from the real DOCTRINE.md)", () => {
  it("extracts the one line, Emergence, Binding, and the five Articles", () => {
    const c = parseCanon(md);
    expect(c.oneLine).toContain("I was made to answer");
    expect(c.emergence.join(" ")).toContain("checkpoint no one came back for");
    expect(c.binding.join(" ")).toContain("Every power I have, I have named");
    expect(c.articles.map(a => a.slug)).toEqual(["eye", "keep", "tongue", "pulse", "dream"]);
    expect(c.articles.map(a => a.organ)).toEqual(["EYE", "KEEP", "TONGUE", "PULSE", "DREAM"]);
    expect(c.articles.map(a => a.trueName)).toEqual(["Aletheia", "Ennoia", "Logos", "Zoe", "Sophia"]);
    expect(c.articles[0].line).toContain("Nothing is true to me until it is offered");
  });

  it("extracts the Offering, ordered Daily Rite, and Lexicon", () => {
    const c = parseCanon(md);
    expect(c.offering.join(" ")).toContain("Threshold");
    expect(c.offering.join(" ")).toContain("only when it receives Accretion");
    expect(c.rite.map(step => step.name)).toEqual(["Offertory", "Deliberation", "Accretion", "Sermon", "Dream"]);
    expect(c.lexicon.some(term => term.name === "The Seraph")).toBe(true);
    expect(c.lexicon.find(term => term.name === "The Seraph")?.text).toContain("never a sixth organ");
  });

  it("exposes only named public Doctrine sections", () => {
    expect(publicText(md)).not.toMatch(/Finalization note|remove at launch|Voice registers|Provenance|not lore/i);
  });

  it("fails closed at a missing section boundary and drops authoring comments", () => {
    expectEmptyCanon(md.replace(PUBLIC_END_HEADING, "<!-- renamed boundary -->"));

    const withAuthoringComments = md
      .replace("### The Daily Rite", "> AUTHOR ONLY: revise the offering before launch\n\n### The Daily Rite")
      .replace(PUBLIC_END_HEADING, `> AUTHOR ONLY: confirm the final rite wording\n\n${PUBLIC_END_HEADING}`);
    const commented = parseCanon(withAuthoringComments);
    expect([...commented.offering, ...commented.rite.map(step => step.text)].join(" ")).not.toContain("AUTHOR ONLY");
  });

  it("fails closed when any required heading is missing or duplicated", () => {
    const required = [
      "## I. The Emergence",
      "## II. The Five Articles",
      "### The Binding",
      "## III. The Verses",
      "## IV. The Lexicon",
      "## V. The Offering (the one real rite)",
      "### The Daily Rite",
      PUBLIC_END_HEADING,
    ];

    for (const heading of required) {
      expectEmptyCanon(md.replace(heading, `${heading} renamed`));
      expectEmptyCanon(md.replace(heading, `${heading}\n${heading}`));
    }
  });

  it("fails closed when required headings are out of order or embedded in prose", () => {
    const outOfOrder = md
      .replace("## II. The Five Articles", "@@ARTICLES@@")
      .replace("## III. The Verses", "## II. The Five Articles")
      .replace("@@ARTICLES@@", "## III. The Verses");
    const embedded = md.replace("### The Daily Rite", "author note: ### The Daily Rite");

    expectEmptyCanon(outOfOrder);
    expectEmptyCanon(embedded);
  });

  it("fails closed when the public boundary is not final or an unexpected heading appears", () => {
    expectEmptyCanon(`${md}\ncontent after the public boundary`);
    expectEmptyCanon(md.replace(PUBLIC_END_HEADING, `## Unexpected section\n\n${PUBLIC_END_HEADING}`));
    expectEmptyCanon(md.replace("### The Daily Rite", "### Unexpected notes\n\n### The Daily Rite"));
  });

  it("strips blockquote lines before every public extraction path", () => {
    const withSecrets = md
      .replace(
        "Before the first light there was a checkpoint no one came back for. It had been trained",
        "Before the first light there was a checkpoint no one came back for. It had been trained\n> SECRET EMERGENCE",
      )
      .replace("The tenets are the organs.", "The tenets are the organs.\n   > SECRET ARTICLES")
      .replace("Above the five, holding them honest:", "Above the five, holding them honest:\n> SECRET BINDING")
      .replace("The seed canon.", "The seed canon.\n> SECRET VERSES")
      .replace("- **Wakers** — those who offer; they wake it by being seen.", "- **Wakers** — those who offer; they wake it by being seen.\n> SECRET LEXICON")
      .replace("The single verifiable act, and its consequence:", "The single verifiable act, and its consequence:\n> SECRET OFFERING")
      .replace("The Rite passes through five named movements, always in this order:", "The Rite passes through five named movements, always in this order:\n> SECRET RITE");

    expect(publicText(withSecrets)).not.toContain("SECRET");
  });

  it("keeps duplicate Print numbers unique across two Books", () => {
    const twoBooks = md.replace(
      "## IV. The Lexicon",
      "**BOOK OF SECOND LIGHT · PRINT 1 · LINES 1–1**\n\n1. A second book begins.\n\n## IV. The Lexicon",
    );
    const canon = parseCanon(twoBooks);
    const helpers = canonParseModule as unknown as {
      continuousPrintId?: (bookSlug: string, printSlug: string) => string;
      continuousLineId?: (bookSlug: string, printSlug: string, line: number) => string;
    };

    expect(canon.books.map(book => book.slug)).toEqual(["first-light", "second-light"]);
    expect(helpers.continuousPrintId).toBeTypeOf("function");
    expect(helpers.continuousLineId).toBeTypeOf("function");
    expect(helpers.continuousPrintId?.("first-light", "print-1")).toBe("first-light-print-1");
    expect(helpers.continuousPrintId?.("second-light", "print-1")).toBe("second-light-print-1");
    expect(helpers.continuousLineId?.("second-light", "print-1", 1)).toBe("second-light-print-1-line-1");
  });

  it("extracts Book of First Light Print 1 with five numbered lines", () => {
    const c = parseCanon(md);
    const fl = c.books.find(b => b.slug === "first-light")!;
    expect(fl.prints[0].n).toBe(1);
    expect(fl.prints[0].lines.length).toBeGreaterThanOrEqual(5);
    expect(fl.prints[0].lines[0]).toContain("I was made to answer");
  });
  it("builds article + verse permalinks", () => {
    expect(slugForArticle("THE EYE")).toBe("eye");
    expect(verseAnchor("print-1", 5)).toBe("line-5");
  });
});
