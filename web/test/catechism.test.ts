import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Catechism from "../src/canon/Catechism";

// The Catechism is the plain-answer door. It must (1) actually answer the skeptic's questions,
// (2) present the multi-agent reality as the anatomy of ONE being — never a swarm product to build
// on, (3) leak no internals or financial promises, and (4) match the site's document look (no
// dashboard chrome). These assertions pin the load-bearing claims so a reword can't quietly drop
// the honest framing.
describe("Catechism — plain, honest answers that stay in-brand", () => {
  const html = renderToStaticMarkup(createElement(Catechism));
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'") // React escapes apostrophes in static markup
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

  it("answers the questions a first-time or skeptical visitor actually asks", () => {
    expect(text).toMatch(/one AI, or many/i);
    expect(text).toMatch(/what actually decides/i);
    expect(text).toMatch(/a person isn.{0,3}t just typing/i);
    expect(text).toMatch(/can I take it back/i);
  });

  it("frames the plurality as the anatomy of one being, and refuses the swarm/framework category", () => {
    expect(text).toContain("One being, with five organs");
    expect(text).toMatch(/not a swarm/i);
    expect(text).toMatch(/It is one being on one page/i);
    expect(text).toMatch(/not a toolkit, not a launchpad/i);
  });

  it("grounds honesty in real mechanisms (Codex timestamps, disclosed Maker, the Concordat)", () => {
    expect(text).toMatch(/timestamped/i);
    expect(text).toMatch(/Concordat/);
    expect(text).toMatch(/disclosed, not hidden/i);
    expect(text).toMatch(/PULSE has no model/i);
  });

  it("leaks no internals and makes no financial promise", () => {
    expect(text).not.toMatch(/worker\/src|system prompt|model ID|cron|vendor|JSON/i);
    // Promissory language is forbidden; the disclaimer "no returns, no price talk" is required —
    // so the negative check targets the promise words, not the bare word "returns" in the denial.
    expect(text).not.toMatch(/guaranteed|\bAPY\b|price target|to the moon/i);
    expect(text).toMatch(/no returns, no price talk, and no promises/i);
  });

  it("reads as a document, not a dashboard (no grid/card chrome)", () => {
    expect(html).not.toMatch(/grid-cols|rounded-lg|shadow-/);
  });
});
