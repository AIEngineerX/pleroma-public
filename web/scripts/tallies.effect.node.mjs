import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer as createViteServer } from "vite";

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_ROOT, "..");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function serverOrigin(server) {
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  return `http://127.0.0.1:${address.port}`;
}

test("Tallies retains a failed same-date refresh but clears date A before date B fails", async () => {
  const requests = [];
  const api = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/fail/api/tallies")) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: "unavailable" }));
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    const date = url.searchParams.get("date");
    response.writeHead(200);
    response.end(JSON.stringify({
      date,
      marks: 2,
      communicants: 1,
      tallies: [{ wallet: "date-a-wallet", count: 2, name: "Date A witness" }],
    }));
  });
  await listen(api);
  const vite = await createViteServer({
    configFile: false,
    logLevel: "silent",
    root: WEB_ROOT,
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const fixtureUrl = new URL("/scripts/fixtures/tallies-effect.html", serverOrigin(vite.httpServer));
    fixtureUrl.searchParams.set("apiBase", serverOrigin(api));
    await page.goto(fixtureUrl.href);
    const attendance = page.getByRole("complementary", { name: "attendance" });
    await assert.doesNotReject(attendance.getByText("2 marks witnessed today", { exact: true }).waitFor());
    await assert.doesNotReject(attendance.getByText("you: Date A witness", { exact: true }).waitFor());

    const sameDateFailure = page.waitForResponse((response) => (
      response.url().includes("/fail/api/tallies?date=2030-01-01")
    ));
    await page.locator("#same-date-failure").click();
    assert.equal((await sameDateFailure).status(), 503);
    assert.equal(await attendance.getByText("2 marks witnessed today", { exact: true }).isVisible(), true);
    assert.equal(await attendance.getByText("you: Date A witness", { exact: true }).isVisible(), true);

    const nextDateFailure = page.waitForResponse((response) => (
      response.url().includes("/fail/api/tallies?date=2030-01-02")
    ));
    await page.locator("#next-date-failure").click();
    assert.equal((await nextDateFailure).status(), 503);
    assert.equal(await page.locator("[data-current-date]").textContent(), "2030-01-02");
    assert.equal(await attendance.getByText("No marks witnessed yet today.", { exact: false }).isVisible(), true);
    assert.equal(await attendance.getByText("you: Date A witness", { exact: true }).count(), 0);
    assert.deepEqual(requests, [
      "/api/tallies?date=2030-01-01",
      "/fail/api/tallies?date=2030-01-01",
      "/fail/api/tallies?date=2030-01-02",
    ]);
  } finally {
    await page.close();
    await browser.close();
    await vite.close();
    await close(api);
  }
});
