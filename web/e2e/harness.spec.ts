import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_PERSIST_PATH as STACK_PERSIST_PATH } from "../scripts/e2e-stack.mjs";
import { E2E_PERSIST_PATH as FIXTURE_PERSIST_PATH } from "./helpers/workerFixture";

const WORKER_ORIGIN = "http://127.0.0.1:8787";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXPECTED_PERSIST_PATH = path.resolve(REPOSITORY_ROOT, ".tmp", "e2e-worker");

test("harness smoke serves the built site through the real Worker", async ({ page }) => {
  await page.goto("/");
  expect(new URL(page.url()).origin).toBe("http://localhost:4173");

  const responses = await page.evaluate(async (workerOrigin) => {
    const [healthResponse, stateResponse] = await Promise.all([
      fetch(`${workerOrigin}/api/health`),
      fetch(`${workerOrigin}/api/state`),
    ]);
    return {
      healthOk: healthResponse.ok,
      health: await healthResponse.json(),
      stateOk: stateResponse.ok,
      stateContentType: stateResponse.headers.get("content-type"),
      state: await stateResponse.json(),
    };
  }, WORKER_ORIGIN);

  expect(responses.healthOk).toBe(true);
  expect(responses.health).toMatchObject({ ok: true });
  expect(responses.stateOk).toBe(true);
  expect(responses.stateContentType).toContain("application/json");
  expect(responses.state).toMatchObject({ phase: "dormant" });
  expect(STACK_PERSIST_PATH).toBe(EXPECTED_PERSIST_PATH);
  expect(FIXTURE_PERSIST_PATH).toBe(EXPECTED_PERSIST_PATH);
});
