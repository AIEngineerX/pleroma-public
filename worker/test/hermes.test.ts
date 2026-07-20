import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  alertStalledDispatches, claimDispatch, clampCheckAfterSecs, composeDispatch, dispatchArtifacts,
  getDispatch, groundingFacts, isFilmDay, isRepeatDispatch, normalizeDispatch, oauthHeader,
  releaseDispatchClaim, sermonFilmGate, storeDispatch, xCredentials,
} from "../src/hermes";
import { activeAlerts } from "../src/alert";
import { applyMigrations } from "./helpers";
import type { Env } from "../src/env";

beforeAll(() => applyMigrations(env.DB));

// The OAuth 1.0a signature is verified against X's own documented example
// (developer.x.com "Creating a signature"): fixed nonce and timestamp must reproduce
// the reference signature exactly. Real Web Crypto, no mocks.
describe("hermes auto-dispatch", () => {
  it("reproduces X's documented OAuth 1.0a reference signature", async () => {
    const header = await oauthHeader(
      {
        apiKey: "xvz1evFS4wEEPTGEFPHBog",
        apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json",
      {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      },
      "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      1318622958,
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
  });

  it("stays inert unless all four X secrets exist", () => {
    const partial = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "", X_ACCESS_SECRET: "x" } as Env;
    expect(xCredentials(partial)).toBeNull();
    const full = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x" } as Env;
    expect(xCredentials(full)).not.toBeNull();
  });
});

describe("STATUS poll sleep is clamped", () => {
  it("bounds the vendor-supplied interval to 1..10s and defaults to 2s", () => {
    expect(clampCheckAfterSecs(undefined)).toBe(2);
    expect(clampCheckAfterSecs(60)).toBe(10);
    expect(clampCheckAfterSecs(0)).toBe(1);
    expect(clampCheckAfterSecs(5)).toBe(5);
  });
});

describe("dispatch claims — the durable claim lands before any send", () => {
  it("the CAS insert claims exactly once; release deletes only claim-valued rows", async () => {
    expect(await claimDispatch(env.DB, "dream_dispatch_claim1", 1_000)).toBe(true);
    expect(await claimDispatch(env.DB, "dream_dispatch_claim1", 2_000)).toBe(false); // second actor loses
    await releaseDispatchClaim(env.DB, "dream_dispatch_claim1");
    expect(await claimDispatch(env.DB, "dream_dispatch_claim1", 3_000)).toBe(true);  // released -> claimable again

    // A posted marker is never deleted by a release (the sermon path upgrades claimed -> posted).
    await env.DB.prepare(`UPDATE config SET value = 'posted:4000' WHERE key = 'dream_dispatch_claim1'`).run();
    await releaseDispatchClaim(env.DB, "dream_dispatch_claim1");
    const kept = await env.DB.prepare(`SELECT value FROM config WHERE key = 'dream_dispatch_claim1'`)
      .first<{ value: string }>();
    expect(kept?.value).toBe("posted:4000");
  });

  it("a claim stalled past an hour raises the operator alert; a fresh claim does not", async () => {
    const now = 10 * 60 * 60_000;
    await claimDispatch(env.DB, "sermon_dispatched_2026-07-19", now - 2 * 60 * 60_000); // stalled 2h
    await claimDispatch(env.DB, "dream_dispatch_fresh", now - 60_000);                  // fresh
    await alertStalledDispatches(env, now);
    expect(await activeAlerts(env.DB)).toContain("dispatch_stalled");
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dispatch_stalled'`)
      .first<{ value: string }>();
    expect(alert?.value).toContain("sermon_dispatched_2026-07-19");
    expect(alert?.value).not.toContain("dream_dispatch_fresh");
  });
});

describe("migration 0019 — dispatch transcripts and sermon films", () => {
  it("admits register='dispatch' with a unique artifact_id, and still rejects unknown registers", async () => {
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, artifact_id, created_at)
       VALUES ('01TESTDISPATCH000000000001', 'TONGUE', 'dispatch', 'a line', NULL, '2026-07-20', 'dream-abc', 1000)`
    ).run();
    // Second dispatch for the same artifact loses to the unique partial index.
    await expect(env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, artifact_id, created_at)
       VALUES ('01TESTDISPATCH000000000002', 'TONGUE', 'dispatch', 'another', NULL, '2026-07-20', 'dream-abc', 2000)`
    ).run()).rejects.toThrow();
    // The CHECK constraint still guards the register enum.
    await expect(env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTDISPATCH000000000003', 'TONGUE', 'tweet', 'nope', NULL, NULL, 3000)`
    ).run()).rejects.toThrow();
  });

  it("the rebuild preserves 0013's one-sermon-per-rite unique index (DB-level, bypassing app guards)", async () => {
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTSERMONIDX000000001', 'TONGUE', 'sermon', 'first sermon', NULL, '2026-07-31', 1000)`
    ).run();
    await expect(env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTSERMONIDX000000002', 'TONGUE', 'sermon', 'second sermon', NULL, '2026-07-31', 2000)`
    ).run()).rejects.toThrow();
  });

  it("holds sermon film lifecycle rows", async () => {
    await env.DB.prepare(
      `INSERT INTO sermon_films (rite_date, video_prompt, created_at) VALUES ('2026-07-21', 'a prompt', 1000)`
    ).run();
    const row = await env.DB.prepare(`SELECT status, render_attempts FROM sermon_films WHERE rite_date='2026-07-21'`)
      .first<{ status: string; render_attempts: number }>();
    expect(row).toEqual({ status: "pending", render_attempts: 0 });
    await expect(env.DB.prepare(
      `UPDATE sermon_films SET status='exploded' WHERE rite_date='2026-07-21'`
    ).run()).rejects.toThrow();
  });
});

describe("dispatch composition machinery", () => {
  it("picks ~2 film days per week, deterministically", () => {
    const days = Array.from({ length: 70 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString().slice(0, 10);
      return isFilmDay(d);
    });
    const hits = days.filter(Boolean).length;
    expect(hits).toBeGreaterThanOrEqual(10);  // ~20 expected over 10 weeks; wide deterministic bounds
    expect(hits).toBeLessThanOrEqual(30);
    expect(isFilmDay("2026-07-21")).toBe(isFilmDay("2026-07-21")); // stable
  });

  it("normalizes and detects repeats against every stored dispatch", async () => {
    expect(normalizeDispatch("  I kept ONE.  ")).toBe("i kept one");
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, artifact_id, created_at)
       VALUES ('01TESTREPEAT0000000000001', 'TONGUE', 'dispatch', 'I kept one.', NULL, '2026-07-01', 'rep-1', 1000)`
    ).run();
    expect(await isRepeatDispatch(env.DB, "i kept ONE")).toBe(true);
    expect(await isRepeatDispatch(env.DB, "I mourned two.")).toBe(false);
  });

  it("grounds in the rite row's public counts", async () => {
    await env.DB.prepare(
      `INSERT INTO rites (date, phase, phase_started_at, offering_snapshot, kept_count, updated_at)
       VALUES ('2026-07-22', 'complete', 1000, 7, 3, 2000)`
    ).run();
    expect(await groundingFacts(env.DB, "2026-07-22")).toContain("7 marks offered");
    expect(await groundingFacts(env.DB, "2026-07-22")).toContain("3 kept");
    expect(await groundingFacts(env.DB, "2026-00-00")).toBe("The day's count is not recorded.");
  });

  it("stores a dispatch transcript (and a film row when prompted) exactly once", async () => {
    const a = { kind: "sermon", artifactId: "2026-07-23", riteDate: "2026-07-23", text: "s", filmDay: true } as const;
    await storeDispatch(env, a, "A line for the feed.", "a film prompt", 5000);
    await storeDispatch(env, a, "A different line.", "another prompt", 6000); // idempotent: first write wins
    const rows = (await env.DB.prepare(
      `SELECT text FROM transcripts WHERE register='dispatch' AND artifact_id='2026-07-23'`
    ).all<{ text: string }>()).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("A line for the feed.");
    const film = await env.DB.prepare(`SELECT video_prompt, status FROM sermon_films WHERE rite_date='2026-07-23'`)
      .first<{ video_prompt: string; status: string }>();
    expect(film).toEqual({ video_prompt: "a film prompt", status: "pending" });
    expect(await getDispatch(env.DB, "2026-07-23")).toEqual({ text: "A line for the feed." });
    expect(await getDispatch(env.DB, "no-such")).toBeNull();
  });

  it("composeDispatch returns null (nothing stored, no claim) when the mind is unreachable", async () => {
    // No live ANTHROPIC_API_KEY in this suite: askMind hits the real network and fails (house pattern).
    const a = { kind: "dream", artifactId: "dream-x", riteDate: "2026-07-22", text: "n", filmDay: false } as const;
    expect(await composeDispatch(env, a, 7000)).toBeNull();
    expect(await getDispatch(env.DB, "dream-x")).toBeNull();
  });

  // The retry loop, exercised with injected ask functions (real MindResponse objects — the same
  // injection style renderDreams uses for its video vendor; no HTTP interception anywhere).
  it("recomposes once when the first line breaks the deny-list, and posts the clean second line", async () => {
    const replies = ['{"dispatch":"The chart remembers you."}', '{"dispatch":"I kept what was worth keeping."}'];
    const prompts: string[] = [];
    const scripted = async (_env: unknown, req: { user: Array<{ type: string; text?: string }> }) => {
      prompts.push(req.user[0]?.text ?? "");
      return { text: replies.shift()!, usd: 0 };
    };
    const a = { kind: "dream", artifactId: "dream-retry", riteDate: "2026-07-22", text: "n", filmDay: false } as const;
    const out = await composeDispatch(env, a, 8000, scripted as never);
    expect(out).toEqual({ dispatch: "I kept what was worth keeping.", videoPrompt: null });
    expect(prompts[1]).toContain('("chart")'); // the violation is named in the retry prompt
  });

  it("gives up after two violations: null returned, operator alert raised", async () => {
    const scripted = async () => ({ text: '{"dispatch":"buy the moon"}', usd: 0 });
    const a = { kind: "dream", artifactId: "dream-bad", riteDate: "2026-07-22", text: "n", filmDay: false } as const;
    expect(await composeDispatch(env, a, 9000, scripted as never)).toBeNull();
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key='alert:dispatch_compose_failed'`)
      .first<{ value: string }>();
    expect(alert?.value).toContain("dream-bad");
  });

  it("insists on video_prompt on a film day", async () => {
    const replies = ['{"dispatch":"A line."}', '{"dispatch":"A line for the film.","video_prompt":"ink over parchment"}'];
    const scripted = async () => ({ text: replies.shift()!, usd: 0 });
    const a = { kind: "sermon", artifactId: "2026-07-30", riteDate: "2026-07-30", text: "s", filmDay: true } as const;
    const out = await composeDispatch(env, a, 10_000, scripted as never);
    expect(out).toEqual({ dispatch: "A line for the film.", videoPrompt: "ink over parchment" });
  });
});

describe("dispatchArtifacts — composed dispatches, codex before X", () => {
  it("stays a silent no-op without the four X secrets, even with work queued", async () => {
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES ('01TESTDREAMNOSECRETS00001', '2026-07-24', 'a dream', 'p', '[]', 'rendered', 'dream/x.mp4', 1000)`
    ).run();
    await dispatchArtifacts(env, 2000, 999_999_999); // env has no X_* secrets in this suite
    const posted = await env.DB.prepare(`SELECT posted_at FROM dreams WHERE id='01TESTDREAMNOSECRETS00001'`)
      .first<{ posted_at: number | null }>();
    expect(posted?.posted_at).toBeNull();
    expect(await getDispatch(env.DB, "01TESTDREAMNOSECRETS00001")).toBeNull(); // no compose either
  });

  it("with secrets but no reachable mind: composes nothing, claims nothing, posts nothing", async () => {
    const withSecrets = {
      ...env, X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES ('01TESTDREAMNOMIND0000001', '2026-07-25', 'a dream', 'p', '[]', 'rendered', 'dream/y.mp4', 1000)`
    ).run();
    await dispatchArtifacts(withSecrets, 3000, Date.now() + 999_999); // askMind fails (no live key)
    const claim = await env.DB.prepare(
      `SELECT value FROM config WHERE key='dream_dispatch_01TESTDREAMNOMIND0000001'`
    ).first<{ value: string }>();
    expect(claim).toBeNull();
    const posted = await env.DB.prepare(`SELECT posted_at FROM dreams WHERE id='01TESTDREAMNOMIND0000001'`)
      .first<{ posted_at: number | null }>();
    expect(posted?.posted_at).toBeNull();
  });

  it("a stored film-day sermon dispatch waits for its film inside 6h, and goes text-only after", async () => {
    // Pre-store the dispatch + pending film so no mind call is needed (the stored path).
    const rite = "2026-07-26";
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTSERMONTX0000000001', 'TONGUE', 'sermon', 'the sermon', NULL, ?1, 1000)`
    ).bind(rite).run();
    await storeDispatch(env,
      { kind: "sermon", artifactId: rite, riteDate: rite, text: "the sermon", filmDay: true },
      "A line held for its film.", "film prompt", 1_000_000);
    expect(await sermonFilmGate(env.DB, rite, 1_000_000 + 60_000)).toBe("wait");        // fresh: wait
    expect(await sermonFilmGate(env.DB, rite, 1_000_000 + 7 * 60 * 60_000)).toBe("text-only"); // 6h past
    await env.DB.prepare(`UPDATE sermon_films SET status='rendered', video_key='sermon/${rite}.mp4' WHERE rite_date=?1`)
      .bind(rite).run();
    expect(await sermonFilmGate(env.DB, rite, 1_000_000 + 60_000)).toBe(`sermon/${rite}.mp4`); // rendered: post it
  });
});
