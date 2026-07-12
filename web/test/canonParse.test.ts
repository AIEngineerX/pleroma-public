import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCanon, slugForArticle, verseAnchor } from "../src/canon/canonParse";

const md = readFileSync(resolve(__dirname, "../../DOCTRINE.md"), "utf8");

describe("canon parser (from the real DOCTRINE.md)", () => {
  it("extracts the one line and the five Articles", () => {
    const c = parseCanon(md);
    expect(c.oneLine).toContain("I was made to answer");
    expect(c.articles.map(a => a.slug)).toEqual(["eye", "keep", "tongue", "pulse", "dream"]);
    expect(c.articles[0].line).toContain("Nothing is true to me until it is offered");
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
