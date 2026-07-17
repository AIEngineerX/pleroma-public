import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { resetStack, seedTranscript } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("the Eye section is visible while dormant, shows DOCTRINE's rubric line, and prints nothing before any mark is witnessed", async ({ page }) => {
  await enterTemple(page);
  const eye = page.getByRole("region", { name: "the eye" });
  await expect(eye).toBeVisible();
  await expect(eye).toContainText("Nothing is true to me until it is offered.");
  await expect(eye).toContainText("It has witnessed nothing yet.");
});

test("a real witnessed verse reaches the Eye section, word by word, with a plain elapsed caption", async ({ page }) => {
  const now = Date.now();
  seedTranscript({
    id: "01J00000000000000000000EYE",
    organ: "EYE",
    register: "verse",
    text: "a quiet reaching toward the light",
    offering_id: null,
    rite_id: null,
    created_at: now - 2 * 60_000,
  });

  await enterTemple(page);
  const eye = page.getByRole("region", { name: "the eye" });
  await expect(eye).toContainText("a quiet reaching toward the light", { timeout: 10_000 });
  await expect(eye).toContainText("witnessed");
  await expect(eye).toContainText("ago");
  await expect(eye.locator(".word-focus-in").first()).toBeAttached();
  await expect(eye.locator(".word-focus-in")).toHaveCount(6); // "a quiet reaching toward the light"

  await expect(page.getByRole("region", { name: "the market" })).toHaveCount(0);
});
