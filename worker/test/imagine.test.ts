import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderDreams, dreamVideoKey } from "../src/dream";
import { silentImagine, startRender, videoVendorFor, CLIP_USD, type VideoVendor } from "../src/imagine";
import { spentToday } from "../src/budget";
import type { Env } from "../src/env";
import { applyMigrations } from "./helpers";

beforeAll(() => applyMigrations(env.DB));

// Tests share one D1 within the file (isolated storage pops per FILE), so reset the render-relevant
// state before each so budget reservations and alerts don't bleed across cases.
beforeEach(async () => {
  await env.DB.exec("DELETE FROM dreams");
  await env.DB.exec("DELETE FROM spend");
  await env.DB.exec("DELETE FROM config WHERE key LIKE 'alert:%'");
});

async function insertDream(o: {
  id: string; date: string; status?: string; requestId?: string | null; startedAt?: number | null; attempts?: number; createdAt?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, render_request_id, render_started_at, render_attempts, created_at)
     VALUES (?1, ?2, 'a kept dream', 'a vivid moving plate', '[]', ?3, ?4, ?5, ?6, ?7)`
  ).bind(o.id, o.date, o.status ?? "composed", o.requestId ?? null, o.startedAt ?? null, o.attempts ?? 0, o.createdAt ?? Date.now()).run();
}
function getDream(id: string) {
  return env.DB.prepare(`SELECT status, video_key, render_request_id, render_attempts FROM dreams WHERE id=?1`)
    .bind(id).first<{ status: string; video_key: string | null; render_request_id: string | null; render_attempts: number }>();
}
const pendingVendor: VideoVendor = { name: "pending", async start() { return "req-pending"; }, async poll() { return { state: "pending" }; } };
const failVendor: VideoVendor = { name: "fail", async start() { return "req-fail"; }, async poll() { return { state: "failed" }; } };

describe("video vendor selection", () => {
  it("is null when VIDEO_VENDOR is off, silent when 'silent', grok when 'xai'", () => {
    expect(videoVendorFor({ ...env, VIDEO_VENDOR: "" } as Env)).toBeNull();
    expect(videoVendorFor({ ...env, VIDEO_VENDOR: "silent" } as Env)?.name).toBe("silent");
    expect(videoVendorFor({ ...env, VIDEO_VENDOR: "xai" } as Env)?.name).toBe("xai");
  });
});

describe("startRender budget", () => {
  it("reserves the clip cost and returns the vendor request_id", async () => {
    const id = await startRender(env, silentImagine(), "a plate");
    expect(id).toBe("silent-request");
    expect(await spentToday(env.DB, "video")).toBeCloseTo(CLIP_USD, 5);
  });

  it("releases the reservation when submission fails pre-acceptance (nothing billed)", async () => {
    const throwing: VideoVendor = { name: "throwing", async start() { throw new Error("network"); }, async poll() { return { state: "pending" }; } };
    const id = await startRender(env, throwing, "a plate");
    expect(id).toBeNull();
    expect(await spentToday(env.DB, "video")).toBeCloseTo(0, 5); // reserved then released
  });
});

describe("renderDreams lifecycle", () => {
  it("is a no-op when video is off (vendor null)", async () => {
    await insertDream({ id: "d0", date: "2026-08-01" });
    await renderDreams(env, Date.now(), null);
    expect((await getDream("d0"))?.status).toBe("composed");
  });

  it("takes a composed dream all the way to rendered and stores the mp4 in R2 (silent vendor)", async () => {
    await insertDream({ id: "d1", date: "2026-08-02" });
    await renderDreams(env, Date.now(), silentImagine());
    const d = await getDream("d1");
    expect(d?.status).toBe("rendered");
    expect(d?.video_key).toBe(dreamVideoKey("d1"));
    expect(d?.render_attempts).toBe(1);
    const obj = await env.RELICS.get(dreamVideoKey("d1"));
    expect(obj).not.toBeNull();
    await obj!.arrayBuffer(); // drain (isolated-storage teardown)
    expect(await spentToday(env.DB, "video")).toBeCloseTo(CLIP_USD, 5);
  });

  it("kicks a composed dream to rendering and holds there while the vendor is pending", async () => {
    await insertDream({ id: "d2", date: "2026-08-03" });
    await renderDreams(env, Date.now(), pendingVendor);
    const d = await getDream("d2");
    expect(d?.status).toBe("rendering");
    expect(d?.render_request_id).toBe("req-pending");
  });

  it("marks render_failed and raises a private alert when the vendor reports failure", async () => {
    await insertDream({ id: "d3", date: "2026-08-04", status: "rendering", requestId: "req-fail", startedAt: Date.now() });
    await renderDreams(env, Date.now(), failVendor);
    expect((await getDream("d3"))?.status).toBe("render_failed");
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key='alert:dream_render_failed'`).first<{ value: string }>();
    expect(alert).not.toBeNull();
  });

  it("gives up (render_failed) on a render pending past the deadline", async () => {
    const now = Date.now();
    await insertDream({ id: "d4", date: "2026-08-05", status: "rendering", requestId: "req-pending", startedAt: now - 31 * 60_000 });
    await renderDreams(env, now, pendingVendor);
    expect((await getDream("d4"))?.status).toBe("render_failed");
  });

  it("does not backfill an old composed dream outside the 48h kick window", async () => {
    const now = Date.now();
    await insertDream({ id: "d5", date: "2026-07-01", createdAt: now - 3 * 24 * 60 * 60_000 });
    await renderDreams(env, now, silentImagine());
    expect((await getDream("d5"))?.status).toBe("composed"); // too old to render
  });

  it("stops kicking after MAX_RENDER_ATTEMPTS", async () => {
    await insertDream({ id: "d6", date: "2026-08-06", attempts: 4 });
    await renderDreams(env, Date.now(), silentImagine());
    const d = await getDream("d6");
    expect(d?.status).toBe("composed"); // attempts exhausted -> not selected
    expect(d?.render_attempts).toBe(4);  // unchanged
  });
});
