import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { moderate } from "../../src/moderation";
import { applyMigrations } from "../helpers";

beforeAll(() => applyMigrations(env.DB));

const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));

describe("moderation (live)", () => {
  it("allows a blank 1x1 doodle", async () => {
    const r = await moderate(env, PNG, "image/png");
    expect(r.verdict).toBe("allow");
  });
});
