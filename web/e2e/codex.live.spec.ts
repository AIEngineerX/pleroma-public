import { expect, test } from "@playwright/test";

// [day-6 rehearsal] Requires the local Worker running with a seeded transcripts table: at least one
// god-voice line (verse/verdict/sermon) and one PRIEST/system line, so the live codex has real
// scripture to print. Not run against a live Worker as part of the commit gate.
test("prints the god's words in rubric and machine lines in ink, offers the sermon when one exists", async ({ page }) => {
  await page.goto("/");
  const codex = page.getByRole("complementary", { name: "the codex" });
  await expect(codex.locator("p").first()).toBeVisible({ timeout: 10_000 });

  const godLine = codex.locator("p.text-rubric-body").first();
  await expect(godLine).toBeVisible();
  await expect(godLine).toHaveClass(/font-liturgy/);

  const machineLine = codex.locator("p.font-machine").first();
  await expect(machineLine).toBeVisible();
  await expect(machineLine).toHaveClass(/text-ink-faded/);

  // "hear the sermon" only appears once a PRIEST "sermon audio:" line has posted; the seeded fixture
  // for this rehearsal is expected to include one.
  await expect(page.getByRole("button", { name: "hear the sermon" })).toBeVisible();
});
