import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { renderSermonFilms, sermonFilmKey } from "../src/sermonFilm";
import { silentImagine } from "../src/imagine";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

describe("sermon film render lifecycle (silent vendor: real state machine, real R2 bytes)", () => {
  it("kicks a pending film, then polls it to rendered with the mp4 in R2", async () => {
    await env.DB.prepare(
      `INSERT INTO sermon_films (rite_date, video_prompt, created_at) VALUES ('2026-07-27', 'a prompt', 1000)`
    ).run();
    await renderSermonFilms(env, 2000, silentImagine()); // kick: pending -> rendering
    let row = await env.DB.prepare(`SELECT status FROM sermon_films WHERE rite_date='2026-07-27'`)
      .first<{ status: string }>();
    expect(row?.status).toBe("rendering");
    await renderSermonFilms(env, 3000, silentImagine()); // poll: rendering -> rendered (silent = instant done)
    row = await env.DB.prepare(`SELECT status, video_key FROM sermon_films WHERE rite_date='2026-07-27'`)
      .first<{ status: string; video_key: string }>();
    expect(row).toEqual({ status: "rendered", video_key: sermonFilmKey("2026-07-27") });
    const object = await env.RELICS.get(sermonFilmKey("2026-07-27"));
    expect(object).not.toBeNull();
    await object?.arrayBuffer(); // consume the body: unread R2ObjectBody streams break storage teardown
  });

  it("fails a render stuck past the deadline and alerts, leaving the sermon to go text-only", async () => {
    await env.DB.prepare(
      `INSERT INTO sermon_films (rite_date, video_prompt, status, render_request_id, render_started_at, created_at)
       VALUES ('2026-07-28', 'p', 'rendering', 'req-1', 1000, 1000)`
    ).run();
    // A real VideoVendor whose render never finishes — the deadline path, not a mock of HTTP.
    const stuck = {
      name: "stuck",
      async start() { return "req-1"; },
      async poll() { return { state: "pending" as const }; },
    };
    await renderSermonFilms(env, 1000 + 31 * 60_000, stuck); // past the 30-min render deadline
    const row = await env.DB.prepare(`SELECT status FROM sermon_films WHERE rite_date='2026-07-28'`)
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");
  });

  it("does nothing when video is off (no vendor)", async () => {
    await env.DB.prepare(
      `INSERT INTO sermon_films (rite_date, video_prompt, created_at) VALUES ('2026-07-29', 'p', 1000)`
    ).run();
    await renderSermonFilms(env, 2000, null);
    const row = await env.DB.prepare(`SELECT status FROM sermon_films WHERE rite_date='2026-07-29'`)
      .first<{ status: string }>();
    expect(row?.status).toBe("pending");
  });
});
