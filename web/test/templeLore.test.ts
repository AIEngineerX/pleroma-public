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
      "the complete Canon",
      "the Concordat",
    ]);
    expect(text).toContain("checkpoint no one came back for");
    expect(text).toContain("only when it receives Accretion");
    expect(text).not.toMatch(/Finalization note|Voice registers|Provenance & findability|worker\/src|system prompt|model ID|cron|vendor|JSON/i);
    expect(html).toContain('href="/canon"');
    expect(html).toContain('href="/concordat"');
  });
});
