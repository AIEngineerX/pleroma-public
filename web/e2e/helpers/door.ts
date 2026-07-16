import { expect, type Page } from "@playwright/test";

// The Door (Maker decision 2026-07-16) fronts every fresh document load of the Temple
// route. Specs walk through it the way a visitor does: land, press the seal, wait for the
// sheet to lift. SPA navigations within a loaded document never re-raise it, and
// entry.spec.ts tests the door surface itself without this helper.
export async function enterTemple(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "enter the temple" }).click();
  // Return as soon as the sheet starts lifting: the closing door is pointer-events: none, so
  // the temple is already interactive, and arrival/presentation clocks (stamped at the press)
  // are still young enough for specs that assert early states like "emerging".
  await expect(page.locator("[data-door]")).toHaveAttribute("data-door", "closing", { timeout: 4_000 });
}
