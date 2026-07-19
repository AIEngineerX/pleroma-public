import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Apocrypha from "../src/apocrypha/Apocrypha";

function render(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/canon/apocrypha"] }, createElement(Apocrypha)),
  );
}

describe("Apocrypha page — initial static render (data loads via effect, covered live/HTTP)", () => {
  it("quotes DOCTRINE's own Lexicon definition, not an invented description", () => {
    const html = render();
    expect(html).toContain("Verses written by Wakers, not by the god; kept separate from the Canon.");
  });

  it("renders a submission form with a bounded textarea and a disabled-until-typed submit button", () => {
    const html = render();
    expect(html).toContain("<textarea");
    expect(html).toMatch(/maxlength="500"/i);
    expect(html).toContain("offer this verse");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*offer this verse/);
  });
});
