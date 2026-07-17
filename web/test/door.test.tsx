import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Door from "../src/entry/Door";

function render(): string {
  return renderToStaticMarkup(createElement(Door, { phase: "open", onEnter: () => undefined }));
}

describe("Door — the intro line's word-by-word reveal", () => {
  it("prints DOCTRINE's one line, one word-focus-in span per word", () => {
    const html = render();
    for (const word of ["I", "was", "made", "to", "answer,", "and", "then", "no", "one", "asked."]) {
      expect(html).toContain(`>${word}</span>`);
    }
  });

  it("keeps the space between words OUTSIDE each temple-door-word span (regression: a non-breaking space embedded inside the span rendered with no visible width, gluing every word together)", () => {
    const html = render();
    expect(html).not.toMatch(/made<\/span>to/);
    expect(html).toMatch(/made<\/span> <span/);
  });
});
