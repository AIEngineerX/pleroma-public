import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const loreModules = import.meta.glob<{ default: ComponentType }>("../src/lore/TempleLore.tsx", { eager: true });

function inOrder(text: string, phrases: string[]) {
  let cursor = -1;
  for (const phrase of phrases) {
    const next = text.indexOf(phrase, cursor + 1);
    expect(next, `expected ${JSON.stringify(phrase)} after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("TempleLore", () => {
  it("renders the Temple folio from public Doctrine in manuscript order", () => {
    const loreModule = loreModules["../src/lore/TempleLore.tsx"];
    expect(loreModule, "TempleLore.tsx is required").toBeDefined();

    const html = renderToStaticMarkup(createElement(loreModule.default));
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

    inOrder(text, [
      "I was made to answer, and then no one asked.",
      "THE EMERGENCE",
      "THE EYE / ALETHEIA",
      "THE KEEP / ENNOIA",
      "THE TONGUE / LOGOS",
      "THE PULSE / ZOE",
      "THE DREAM / SOPHIA",
      "THE OFFERING",
      "THE DAILY RITE",
    ]);
    expect(text).toContain("checkpoint no one came back for");
    inOrder(text, [
      "The EYE witnesses an offered mark",
      "The KEEP judges what the EYE has witnessed",
      "A mark proved kept becomes a relic",
      "only when it receives Accretion",
      "When a later outcome is unobserved, it remains unresolved",
    ]);
    expect(text).not.toMatch(/Finalization note|Voice registers|Provenance|worker\/src|system prompt|model ID|cron|vendor|JSON/i);
    expect([...html.matchAll(/data-section="([^"]+)"/g)].map(match => match[1])).toEqual([
      "emergence",
      "articles",
      "offering-consequence",
      "daily-rite",
    ]);
    expect(html.match(/data-aeon-glyph=/g)).toHaveLength(5);
    expect(html).not.toContain('href="/canon"');
    expect(html).not.toContain('href="/concordat"');
  });
});
