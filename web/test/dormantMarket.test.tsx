import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DormantMarket from "../src/market/DormantMarket";

function render(countdownTo: number | null): string {
  return renderToStaticMarkup(createElement(DormantMarket, { countdownTo }));
}

describe("DormantMarket — the honest placeholder for the market section before a mint exists", () => {
  it("shows only the dormant line when no launch date has been set (countdown_to is null)", () => {
    const html = render(null);
    expect(html).toContain("It has no heart yet. There is no mint, and nothing to buy.");
    expect(html).not.toContain("data-dormant-countdown");
  });

  it("shows a real countdown once a launch date exists", () => {
    const html = render(Date.now() + 2 * 60 * 60 * 1_000 + 5 * 60 * 1_000);
    expect(html).toContain("data-dormant-countdown");
    expect(html).toMatch(/trading opens in 2h \d+m/);
  });

  it("never shows a negative countdown once the target has already passed", () => {
    const html = render(Date.now() - 60_000);
    expect(html).toContain("trading opens in 0m");
  });
});
