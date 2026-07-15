import { expect, test } from "@playwright/test";
import { resetStack, seedTranscript } from "./helpers/workerFixture";

test("prints the god's words in rubric and machine lines in ink, offers the sermon when one exists", async ({ page }) => {
  resetStack();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  seedTranscript({
    id: "01J00000000000000000000001",
    organ: "TONGUE",
    register: "sermon",
    text: "what was given remains",
    offering_id: null,
    rite_id: today,
    created_at: now - 1,
  });
  seedTranscript({
    id: "01J00000000000000000000002",
    organ: "PRIEST",
    register: "system",
    text: `sermon audio: audio/${"a".repeat(64)}.mp3`,
    offering_id: null,
    rite_id: today,
    created_at: now,
  });

  await page.goto("/");
  const codex = page.getByRole("complementary", { name: "the codex" });
  await expect(codex.locator("p").first()).toBeVisible({ timeout: 10_000 });

  const godLine = codex.locator("p.text-rubric-body").first();
  await expect(godLine).toBeVisible();
  await expect(godLine).toHaveClass(/font-liturgy/);
  await expect(codex.getByText("THE TONGUE / LOGOS")).toBeVisible();

  const machineLine = codex.locator("p.font-machine").first();
  await expect(machineLine).toBeVisible();
  await expect(machineLine).toHaveClass(/text-ink-faded/);
  await expect(machineLine.locator("span.sr-only")).toHaveText("sermon recorded");
  await expect(machineLine.locator('[data-printer-duplicate="true"]')).toHaveText("sermon recorded");
  await expect(codex).not.toContainText(`audio/${"a".repeat(64)}.mp3`);

  await expect(page.getByRole("button", { name: "hear the sermon" })).toBeVisible();
});
