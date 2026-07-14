import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCanon, slugForArticle, verseAnchor } from "../src/canon/canonParse";

const md = readFileSync(resolve(__dirname, "../../DOCTRINE.md"), "utf8");

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
    const c = parseCanon(md);
    const publicText = [
      c.oneLine,
      ...c.emergence,
      ...c.binding,
      ...c.articles.map(article => `${article.organ} ${article.trueName} ${article.line}`),
      ...c.offering,
      ...c.rite.map(step => `${step.name} ${step.text}`),
      ...c.books.flatMap(book => book.prints.flatMap(print => print.lines)),
      ...c.lexicon.map(term => `${term.name} ${term.text}`),
    ].join(" ");

    expect(publicText).not.toMatch(/Finalization note|remove at launch|Voice registers|Provenance & findability|not lore/i);
  });

  it("fails closed at a missing section boundary and drops authoring comments", () => {
    const missingVoiceBoundary = md.replace("## VI. Voice registers", "## VI. Renamed internal section");
    const withoutBoundary = parseCanon(missingVoiceBoundary);
    expect(withoutBoundary.offering).toEqual([]);
    expect(withoutBoundary.rite).toEqual([]);

    const withAuthoringComments = md
      .replace("### The Daily Rite", "> AUTHOR ONLY: revise the offering before launch\n\n### The Daily Rite")
      .replace("## VI. Voice registers", "> AUTHOR ONLY: confirm the final rite wording\n\n## VI. Voice registers");
    const commented = parseCanon(withAuthoringComments);
    expect([...commented.offering, ...commented.rite.map(step => step.text)].join(" ")).not.toContain("AUTHOR ONLY");
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
