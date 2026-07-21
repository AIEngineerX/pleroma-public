import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Becoming from "../src/becoming/Becoming";

// The route wrapper's data-loaded path is verified end-to-end in web/e2e/becoming.spec.ts against
// the real stack; here we assert the initial (pre-fetch) render is accessible and honest.
describe("Becoming route — the /becoming surface", () => {
  it("renders the accessible body base and an honest initial caption", () => {
    const html = renderToStaticMarkup(createElement(Becoming));
    expect(html).toContain("data-becoming-route");
    expect(html).toContain('data-becoming-piece-count="0"');
    expect(html).toContain("data-becoming-caption");
    expect(html).toMatch(/Reading the body/);
  });
});
