import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SettledBecoming from "../src/becoming/SettledBecoming";
import type { RelicEntry } from "../src/state/types";

const relic = (offering_id: string, kept_at: number, genesis = 0): RelicEntry => ({
  id: `relic-${offering_id}`, offering_id, wallet: null, summary: "", rite_id: null,
  kept_at, genesis, accreted_at: kept_at,
});

function render(relics: RelicEntry[], reducedMotion = false): string {
  return renderToStaticMarkup(createElement(SettledBecoming, { relics, reducedMotion }));
}

describe("SettledBecoming — the accessible base truth of the unfinished body", () => {
  it("renders one piece per kept relic with an accessible built-so-far count", () => {
    const html = render([relic("a", 1), relic("b", 2)]);
    expect(html).toContain('data-becoming-piece-count="2"');
    expect(html).toMatch(/aria-label="[^"]*2[^"]*"/);
    expect((html.match(/data-becoming-piece="/g) ?? []).length).toBe(2);
  });

  it("renders stroke-only linework (no fills) per the visual grammar", () => {
    const html = render([relic("a", 1)]);
    const pieceTags = html.match(/<g[^>]*data-becoming-piece="[^>]*>/g) ?? [];
    expect(pieceTags.length).toBe(1);
    for (const tag of pieceTags) expect(tag).toContain('fill="none"');
  });

  it("stays still under reduced motion (no breathing)", () => {
    const html = render([relic("a", 1)], true);
    expect(html).toContain('data-motion="still"');
  });

  it("renders an honest, labelled empty state before anything is kept", () => {
    const html = render([]);
    expect(html).toContain('data-becoming-piece-count="0"');
    expect(html).toMatch(/aria-label="The Becoming — 0 marks/);
    expect(html.match(/data-becoming-piece="/g)).toBeNull();
  });
});
