import { expect, test } from "@playwright/test";
import { enterTemple } from "./helpers/door";
import { expectDormantMarketOnly } from "./helpers/dormantMarket";
import { resetStack, seedTranscript } from "./helpers/workerFixture";

test.beforeEach(() => resetStack());

test("the Tongue section is visible while dormant, shows DOCTRINE's rubric line, and prints nothing before anything is said", async ({ page }) => {
  await enterTemple(page);
  const tongue = page.getByRole("region", { name: "the tongue" });
  await expect(tongue).toBeVisible();
  await expect(tongue).toContainText("I answer to no prompt. I speak when I have something to say.");
  await expect(tongue).toContainText("It has said nothing yet.");
});

test("falls back to the latest ambient line when no sermon has been spoken yet, with no play control", async ({ page }) => {
  seedTranscript({
    id: "01J0000000000000000TONGUE1",
    organ: "TONGUE",
    register: "verse",
    text: "a small aside, unprompted",
    offering_id: null,
    rite_id: null,
    created_at: Date.now() - 60_000,
  });

  await enterTemple(page);
  const tongue = page.getByRole("region", { name: "the tongue" });
  await expect(tongue).toContainText("a small aside, unprompted", { timeout: 10_000 });
  await expect(tongue).toContainText("spoken");
  await expect(tongue.getByRole("button", { name: "play the sermon" })).toHaveCount(0);
});

test("a spoken sermon with matching recorded audio gets its own play control and bars, prioritized over ambient chatter", async ({ page }) => {
  const now = Date.now();
  const riteDate = new Date(now).toISOString().slice(0, 10);
  seedTranscript({
    id: "01J0000000000000000TONGUE2",
    organ: "TONGUE",
    register: "verse",
    text: "an older ambient aside",
    offering_id: null,
    rite_id: null,
    created_at: now - 5 * 60_000,
  });
  seedTranscript({
    id: "01J0000000000000000TONGUE3",
    organ: "TONGUE",
    register: "sermon",
    text: "what was given remains",
    offering_id: null,
    rite_id: riteDate,
    created_at: now - 1_000,
  });
  seedTranscript({
    id: "01J0000000000000000TONGUE4",
    organ: "PRIEST",
    register: "system",
    text: `sermon audio: audio/${"c".repeat(64)}.mp3`,
    offering_id: null,
    rite_id: riteDate,
    created_at: now,
  });

  await enterTemple(page);
  const tongue = page.getByRole("region", { name: "the tongue" });
  await expect(tongue).toContainText("what was given remains", { timeout: 10_000 });
  await expect(tongue).toContainText("the sermon");
  await expect(tongue).not.toContainText("an older ambient aside");

  const playButton = tongue.getByRole("button", { name: "play the sermon" });
  await expect(playButton).toBeVisible();
  await expect(tongue.locator("[data-tongue-bars]")).toBeAttached();

  await expectDormantMarketOnly(page);
});
