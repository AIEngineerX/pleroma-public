import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  alertStalledDispatches, alertUnpostedArtifacts, claimDispatch, clampCheckAfterSecs, composeDispatch, dispatchArtifacts,
  dispatchMode, getDispatch, groundingFacts, isFilmDay, isRepeatDispatch, normalizeDispatch, oauthHeader, SCRIPTURE_WINDOWS, scriptureWindow,
  releaseDispatchClaim, sermonFilmGate, storeDispatch, weightedTweetLength, xCredentials, scriptureAnchor, openingKey,
} from "../src/hermes";
import { scripturePool } from "../src/doctrine";
import { STILL_ESTIMATE_USD } from "../src/imagine";
import { CAPS_USD } from "../src/budget";
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

  // Variety by construction (the de-mundane fix): each artifact gets ONE deterministic shape, so the
  // feed cannot collapse into a single "N offered, one kept" skeleton the way variety-by-instruction did.
  it("rotates dispatch shape deterministically: PLATE on film days, SCRIPTURE a gated minority, dreams never a bare tally", () => {
    const filmA = { kind: "sermon", artifactId: "2026-09-01", riteDate: "2026-09-01", text: "s", filmDay: true } as const;
    expect(dispatchMode(filmA)).toBe("PLATE");
    expect(dispatchMode(filmA)).toBe("PLATE"); // stable

    const N = 300;
    let sScripture = 0, sTally = 0, dTally = 0;
    for (let i = 0; i < N; i++) {
      const sm = dispatchMode({ kind: "sermon", artifactId: `s-${i}`, riteDate: "d", text: "s", filmDay: false });
      const dm = dispatchMode({ kind: "dream", artifactId: `d-${i}`, riteDate: "d", text: "n", filmDay: false });
      if (sm === "SCRIPTURE") sScripture++;
      if (sm === "TALLY") sTally++;
      if (dm === "TALLY") dTally++;
    }
    expect(sScripture / N).toBeLessThan(0.35); // gated: grounded shapes dominate the feed (receipts discipline)
    expect(sScripture).toBeGreaterThan(0);      // but the god does speak pure scripture sometimes
    expect(sTally).toBeGreaterThan(0);          // the real count stays regularly cited
    expect(dTally).toBe(0);                      // dreams stay lyric, never a bare tally report
  });

  it("SCRIPTURE-shape omits the day's count and withholds today's artifact, drawing on the canon; grounded shapes cite the count", async () => {
    await env.DB.prepare(
      `INSERT INTO rites (date, phase, phase_started_at, offering_snapshot, kept_count, updated_at)
       VALUES ('2026-09-03', 'complete', 1000, 9, 3, 2000)`
    ).run();
    const idForMode = (kind: "sermon" | "dream", mode: string): string => {
      for (let i = 0; i < 3000; i++) {
        const artifactId = `probe-${kind}-${i}`;
        if (dispatchMode({ kind, artifactId, riteDate: "2026-09-03", text: "t", filmDay: false }) === mode) return artifactId;
      }
      throw new Error(`no id maps to ${mode}`);
    };
    let n = 0;
    const captured: string[] = [];
    const capture = (async (_e: unknown, req: { user: Array<{ text?: string }> }) => {
      captured.push(req.user[0]?.text ?? "");
      return { text: `{"dispatch":"a wholly novel utterance number ${n++}"}`, usd: 0 };
    }) as never;

    // SCRIPTURE: no count, no artifact, the canon is present.
    const sid = idForMode("sermon", "SCRIPTURE");
    await composeDispatch(env, { kind: "sermon", artifactId: sid, riteDate: "2026-09-03", text: "the sermon body text", filmDay: false }, 1000, capture);
    const scripturePrompt = captured.at(-1)!;
    expect(scripturePrompt).not.toContain("9 marks offered");
    expect(scripturePrompt).not.toContain("the sermon body text");
    expect(scripturePrompt.toLowerCase()).toContain("canon");

    // A grounded shape (TALLY): cites the real count and is given today's artifact.
    const tid = idForMode("sermon", "TALLY");
    await composeDispatch(env, { kind: "sermon", artifactId: tid, riteDate: "2026-09-03", text: "the sermon body text", filmDay: false }, 2000, capture);
    const tallyPrompt = captured.at(-1)!;
    expect(tallyPrompt).toContain("9 marks offered");
    expect(tallyPrompt).toContain("the sermon body text");
  });

  // Cadence: break the ~20h daytime silence with pure-canon posts in spread UTC windows.
  it("scriptureWindow fires only in the spread daytime windows, never during the rite/dream cluster", () => {
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 11, 30))).toEqual({ date: "2026-07-21", hour: 11 });
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 14, 0))).toEqual({ date: "2026-07-21", hour: 14 });
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 17, 45))).toEqual({ date: "2026-07-21", hour: 17 });
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 20, 5))).toEqual({ date: "2026-07-21", hour: 20 });
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 23, 59))).toEqual({ date: "2026-07-21", hour: 23 });
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 10, 0))).toEqual({ date: "2026-07-21", hour: 10 });
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 2, 0))).toBeNull();  // ~01-04 UTC: the cluster already posts
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 3, 0))).toBeNull();  // the dream posts here
    expect(scriptureWindow(Date.UTC(2026, 6, 21, 9, 0))).toBeNull();  // before the first window, not a window
    // hourly across the daytime span: every hour 10..23 is a window, nothing outside it is
    for (let h = 10; h <= 23; h++) expect(scriptureWindow(Date.UTC(2026, 6, 21, h, 30))).not.toBeNull();
    for (let h = 0; h <= 9; h++) expect(scriptureWindow(Date.UTC(2026, 6, 21, h, 30))).toBeNull();
    // every window is clear of the night cluster, so a standalone post never lands on top of it
    expect(SCRIPTURE_WINDOWS.some((h) => h >= 1 && h <= 4)).toBe(false);
    // a standalone scripture artifact always composes in the SCRIPTURE shape
    expect(dispatchMode({ kind: "scripture", artifactId: "scripture-2026-07-21-15", riteDate: "2026-07-21", text: "", filmDay: false })).toBe("SCRIPTURE");
  });

  // The cadence is capped by the image budget, not by taste. Every standalone dispatch renders a
  // still that reserves STILL_ESTIMATE_USD against the daily image cap; if the windows ever outgrow
  // that cap, the late windows of EVERY day silently lose their images while still posting — a
  // degradation with no error and no alert. Widening the cadence without raising the cap fails here.
  it("a full day of standalone dispatches fits inside the daily image cap", () => {
    const reservedPerDay = SCRIPTURE_WINDOWS.length * STILL_ESTIMATE_USD;
    expect(reservedPerDay).toBeLessThanOrEqual(CAPS_USD.image);
    // and keep real headroom for render retries rather than sitting exactly on the ceiling
    expect(reservedPerDay).toBeLessThanOrEqual(CAPS_USD.image * 0.8);
  });

  it("scriptureAnchor rotates a different canon line per window off a pool wider than the one line", () => {
    const pool = scripturePool();
    expect(pool.length).toBeGreaterThanOrEqual(15); // every god ⟨rubric⟩ line + Print 1 verses, deduped
    expect(pool.some((l) => /hundred hands|thousand keep/i.test(l))).toBe(false); // auguries excluded
    // Across a week of the same window, the anchors spread — they do NOT all collapse onto one line.
    const week = Array.from({ length: 7 }, (_, d) => scriptureAnchor(`scripture-2026-07-${10 + d}-15`));
    expect(new Set(week).size).toBeGreaterThanOrEqual(4);
    for (const a of week) expect(pool).toContain(a); // every anchor is a real canon line
    // Deterministic: same id -> same anchor (idempotent across ticks/retries).
    expect(scriptureAnchor("scripture-2026-07-22-21")).toBe(scriptureAnchor("scripture-2026-07-22-21"));
  });

  it("composeDispatch rejects a near-duplicate opening (same first 6 words as a recent post), then retries", async () => {
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTOPENING00000000001', 'TONGUE', 'dispatch', 'I was made to answer and I turned inward', NULL, NULL, 9000000)`
    ).run();
    expect(openingKey("I was made to answer and then I waited"))
      .toBe(openingKey("I was made to answer and I turned inward")); // first 6 words collide
    let call = 0;
    const capture = (async () => {
      call++;
      return { text: call === 1
        ? `{"dispatch":"I was made to answer and then I waited"}`     // near-dup opening -> rejected
        : `{"dispatch":"Silence is also a kind of speech I keep"}`, usd: 0 }; // fresh opening -> accepted
    }) as never;
    const artifact = { kind: "scripture", artifactId: "scripture-2026-09-06-21", riteDate: "2026-09-06", text: "", filmDay: false } as const;
    const out = await composeDispatch(env, artifact, 6000, capture);
    expect(call).toBe(2); // retried after the near-duplicate was rejected
    expect(out?.dispatch).toBe("Silence is also a kind of speech I keep");
  });

  it("a STATE post speaks the day's real record honestly, including a day that kept nothing", async () => {
    await env.DB.prepare(
      `INSERT INTO rites (date, phase, phase_started_at, offering_snapshot, kept_count, updated_at)
       VALUES ('2026-09-07', 'complete', 1000, 1, 0, 2000)`
    ).run();
    const captured: string[] = [];
    const capture = (async (_e: unknown, req: { user: Array<{ text?: string }> }) => {
      captured.push(req.user[0]?.text ?? "");
      return { text: `{"dispatch":"One came to me today and I kept nothing of it"}`, usd: 0 };
    }) as never;
    const artifact = { kind: "state", artifactId: "state-2026-09-07-15", riteDate: "2026-09-07", text: "", filmDay: false } as const;
    expect(dispatchMode(artifact)).toBe("STATE");
    const out = await composeDispatch(env, artifact, 7000, capture);
    expect(out?.dispatch).toContain("kept nothing");
    const prompt = captured.at(-1)!;
    expect(prompt).toContain("1 marks offered"); // grounded in the real record, not canon
    expect(prompt).toContain("0 kept");
    expect(prompt).not.toContain("draw ONLY from this one article"); // not the scripture path
  });

  it("a standalone scripture dispatch composes from the canon and makes no claim about the day", async () => {
    await env.DB.prepare(
      `INSERT INTO rites (date, phase, phase_started_at, offering_snapshot, kept_count, updated_at)
       VALUES ('2026-09-05', 'complete', 1000, 9, 3, 2000)`
    ).run();
    const captured: string[] = [];
    let n = 0;
    const capture = (async (_e: unknown, req: { user: Array<{ text?: string }> }) => {
      captured.push(req.user[0]?.text ?? "");
      return { text: `{"dispatch":"a wholly novel scripture line ${n++}"}`, usd: 0 };
    }) as never;
    const artifact = { kind: "scripture", artifactId: "scripture-2026-09-05-15", riteDate: "2026-09-05", text: "", filmDay: false } as const;
    const out = await composeDispatch(env, artifact, 1000, capture);
    expect(out?.dispatch).toContain("scripture line");
    const prompt = captured.at(-1)!;
    expect(prompt).not.toContain("9 marks offered"); // ignores the day's real count even though the rite exists
    expect(prompt.toLowerCase()).toContain("canon");  // draws only from the published canon
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

  it("counts X's weighted length: typographic marks weigh 2, so 280 JS chars can be over", () => {
    expect(weightedTweetLength("a".repeat(280))).toBe(280);
    expect(weightedTweetLength("…")).toBe(2);       // U+2026 is outside the weight-1 ranges
    expect(weightedTweetLength("夢")).toBe(2);       // CJK weighs 2
    expect(weightedTweetLength("–")).toBe(1);  // en dash U+2013 is inside 8208-8223
  });

  it("rejects an over-weighted dispatch that fits in JS chars, then accepts the shorter recompose", async () => {
    const replies = [
      JSON.stringify({ dispatch: "夢".repeat(141) }),  // 141 JS chars, 282 weighted
      JSON.stringify({ dispatch: "I kept the dream of doors." }),
    ];
    const scripted = async () => ({ text: replies.shift()!, usd: 0 });
    const a = { kind: "dream", artifactId: "dream-weighted", riteDate: "2026-07-22", text: "n", filmDay: false } as const;
    const out = await composeDispatch(env, a, 11_000, scripted as never);
    expect(out).toEqual({ dispatch: "I kept the dream of doors.", videoPrompt: null });
  });

  it("rejects links, hashtags, and questions mechanically", async () => {
    const replies = [
      '{"dispatch":"read the page at https://example.com"}',
      '{"dispatch":"#awake and counting"}',
      '{"dispatch":"who watches me now?"}',
      '{"dispatch":"Three hands came; I kept one."}',
    ];
    const scripted = async () => ({ text: replies.shift()!, usd: 0 });
    const a = { kind: "dream", artifactId: "dream-styled", riteDate: "2026-07-22", text: "n", filmDay: false } as const;
    // 2-attempt loop: link then hashtag exhausts one composeDispatch call -> null + alert
    expect(await composeDispatch(env, a, 12_000, scripted as never)).toBeNull();
    // next tick's call: question then clean line -> accepted
    const out = await composeDispatch(env, a, 13_000, scripted as never);
    expect(out).toEqual({ dispatch: "Three hands came; I kept one.", videoPrompt: null });
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
    // Every test in this file shares one D1 (beforeAll runs once); the oldest-unposted-dream query
    // would otherwise pick up an earlier test's leftover row instead of ours.
    await env.DB.prepare("UPDATE dreams SET posted_at = 999 WHERE posted_at IS NULL").run();
    const withSecrets = {
      ...env, X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES ('01TESTDREAMNOMIND0000001', '2026-07-25', 'a dream', 'p', '[]', 'rendered', 'dream/y.mp4', 1000)`
    ).run();
    // The R2 object at video_key MUST exist: without it, `object` is null and the claim is skipped
    // by the object-fetch guard regardless of whether compose failed — a confound that would let
    // this test pass even if a compose failure wrongly claimed. Real bytes isolate the assertion to
    // "compose failed" as the actual reason nothing was claimed or posted.
    await env.RELICS.put("dream/y.mp4", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    await dispatchArtifacts(withSecrets, 3000, Date.now() + 999_999); // askMind fails (no live key)
    expect(await getDispatch(env.DB, "01TESTDREAMNOMIND0000001")).toBeNull(); // nothing composed/stored
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

  it("a stored dream dispatch is released on a live-network throw, and survives for retry", async () => {
    await env.DB.prepare("UPDATE dreams SET posted_at = 999 WHERE posted_at IS NULL").run();
    const withSecrets = {
      ...env, X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    const id = "01TESTDREAMTHROW0000001";
    const rite = "2026-07-27";
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES (?1, ?2, 'a dream', 'p', '[]', 'rendered', 'dream/throw.mp4', 1000)`
    ).bind(id, rite).run();
    await env.RELICS.put("dream/throw.mp4", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    // Pre-store the dispatch (bypasses composeDispatch, which would hit the live mind and fail) so
    // this test isolates the claim -> send -> release path, not composition.
    await storeDispatch(env,
      { kind: "dream", artifactId: id, riteDate: rite, text: "n", filmDay: false },
      "A held line.", null, 2000);
    // uploadVideo's INIT call hits the real X endpoint with bogus creds and throws (non-2xx or
    // transport failure) — dispatchArtifacts rethrows.
    await expect(dispatchArtifacts(withSecrets, 3000, Date.now() + 999_999)).rejects.toThrow();
    const claim = await env.DB.prepare(`SELECT value FROM config WHERE key = ?1`)
      .bind(`dream_dispatch_${id}`).first<{ value: string }>();
    expect(claim).toBeNull(); // released on throw, not left claimed
    const posted = await env.DB.prepare(`SELECT posted_at FROM dreams WHERE id = ?1`).bind(id)
      .first<{ posted_at: number | null }>();
    expect(posted?.posted_at).toBeNull();
    expect(await getDispatch(env.DB, id)).toEqual({ text: "A held line." }); // survives for the retry
  });

  it("a stored sermon dispatch is released on a live-network throw, and survives for retry", async () => {
    // Neutralize every leftover unposted dream so the dream block is a no-op and the sermon block
    // is reached in this same call.
    await env.DB.prepare("UPDATE dreams SET posted_at = 999 WHERE posted_at IS NULL").run();
    // Neutralize leftover unposted sermon rites from earlier tests in this file (e.g. '2026-07-31'
    // from the migration 0019 describe, '2026-07-26' from the film-gate test above) by marking them
    // posted — not released — so the sermon query's NOT EXISTS skips them without touching the
    // release-vs-posted distinction this test pins.
    const leftoverSermons = (await env.DB.prepare(
      `SELECT DISTINCT rite_id FROM transcripts WHERE organ='TONGUE' AND register='sermon' AND rite_id IS NOT NULL`
    ).all<{ rite_id: string }>()).results;
    for (const { rite_id } of leftoverSermons) {
      await env.DB.prepare(
        `INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).bind(`sermon_dispatched_${rite_id}`, "posted:1").run();
    }

    const withSecrets = {
      ...env, X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    const rite = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].find((d) => !isFilmDay(d))!;
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTSERMONTHROW000001', 'TONGUE', 'sermon', 'the sermon', NULL, ?1, 1000)`
    ).bind(rite).run();
    // Pre-store the dispatch so composeDispatch (which would hit the live mind and fail) is bypassed.
    await storeDispatch(env,
      { kind: "sermon", artifactId: rite, riteDate: rite, text: "s", filmDay: false },
      "A held sermon line.", null, 2000);
    // tweet() hits the real X endpoint with bogus creds and throws — dispatchArtifacts rethrows.
    await expect(dispatchArtifacts(withSecrets, 3000, Date.now() + 999_999)).rejects.toThrow();
    const claim = await env.DB.prepare(`SELECT value FROM config WHERE key = ?1`)
      .bind(`sermon_dispatched_${rite}`).first<{ value: string }>();
    expect(claim).toBeNull(); // released (deleted), not left at "posted:"
    expect(await getDispatch(env.DB, rite)).toEqual({ text: "A held sermon line." }); // survives for retry
  });
});

// Each `it` below is self-contained (vitest-pool-workers' isolated storage resets D1 between tests
// even within one file, so state is never carried from a sibling test — only sequential calls
// inside the SAME test see each other's writes, exactly like the sermonFilmGate test above).
describe("the unposted watchdog — silence measured from postable-first-seen, not created_at", () => {
  const withSecrets = { ...env, X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x" } as Env;
  const HOUR = 60 * 60_000;

  it("stays silent without the four X secrets, even with an ancient unposted dream — and stamps no marker", async () => {
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES ('01TESTWATCHDOG0000000001', '2026-08-10', 'n', 'p', '[]', 'rendered', 'dream/w1.mp4', 1000)`
    ).run();
    await alertUnpostedArtifacts(env, 1000 + 50 * HOUR);
    expect(await activeAlerts(env.DB)).not.toContain("dispatch_unposted");
    const marker = await env.DB.prepare(
      `SELECT value FROM config WHERE key = 'unposted_seen_01TESTWATCHDOG0000000001'`
    ).first();
    expect(marker).toBeNull();
  });

  it("a dream's lifecycle: first sweep stamps postable-first-seen (no alert) -> a sweep past the 2h leash alerts -> posting self-clears the marker and the alert row", async () => {
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES ('01TESTWATCHDOG0000000003', '2026-08-13', 'n', 'p', '[]', 'rendered', 'dream/w3.mp4', 1000)`
    ).run();

    // First credentialed sweep: stamps postable-first-seen, does NOT alert (0 elapsed since the
    // stamp). Without this stamp-first behavior, the very first credentialed tick over an old
    // backlog (created_at far in the past) would wrongly cry wolf on an artifact the dispatcher is
    // about to drain healthily one at a time.
    await alertUnpostedArtifacts(withSecrets, 5_000);
    expect(await activeAlerts(env.DB)).not.toContain("dispatch_unposted");
    const marker = await env.DB.prepare(
      `SELECT value FROM config WHERE key = 'unposted_seen_01TESTWATCHDOG0000000003'`
    ).first<{ value: string }>();
    expect(marker?.value).toBe("5000"); // first-seen stamped at this sweep's `now`, not created_at

    // A second sweep past the 2h dream leash, measured from the marker (not created_at): DOES alert.
    await alertUnpostedArtifacts(withSecrets, 5_000 + 3 * HOUR);
    expect(await activeAlerts(env.DB)).toContain("dispatch_unposted");
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dispatch_unposted'`)
      .first<{ value: string }>();
    expect(alert?.value).toContain("dream 01TESTWATCHDOG0000000003");

    // Once posted, a further sweep clears both the config marker and the alert row itself — not
    // merely un-alerted: the alert:dispatch_unposted row is deleted (the first self-clearing alert),
    // so /api/state's public `degraded` flag stops reflecting a now-resolved wolf-cry.
    await env.DB.prepare(`UPDATE dreams SET posted_at = 1 WHERE id = '01TESTWATCHDOG0000000003'`).run();
    await alertUnpostedArtifacts(withSecrets, 5_000 + 4 * HOUR);
    expect(await activeAlerts(env.DB)).not.toContain("dispatch_unposted");
    const clearedMarker = await env.DB.prepare(
      `SELECT value FROM config WHERE key = 'unposted_seen_01TESTWATCHDOG0000000003'`
    ).first();
    expect(clearedMarker).toBeNull();
    const clearedAlert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dispatch_unposted'`).first();
    expect(clearedAlert).toBeNull();
  });

  it("a sermon's lifecycle: first sweep stamps (no alert) -> a sweep past the 7h leash alerts -> its dispatch marker landing self-clears both", async () => {
    const rite = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"].find((d) => !isFilmDay(d))!;
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTWATCHDOGSERMON0001', 'TONGUE', 'sermon', 's', NULL, ?1, 1000)`
    ).bind(rite).run();

    await alertUnpostedArtifacts(withSecrets, 5_000);
    expect(await activeAlerts(env.DB)).not.toContain("dispatch_unposted");
    const marker = await env.DB.prepare(`SELECT value FROM config WHERE key = ?1`)
      .bind(`unposted_seen_sermon_${rite}`).first<{ value: string }>();
    expect(marker?.value).toBe("5000");

    // Past the 7h sermon leash (FILM_WAIT_MS + 1h), measured from the marker.
    await alertUnpostedArtifacts(withSecrets, 5_000 + 8 * HOUR);
    expect(await activeAlerts(env.DB)).toContain("dispatch_unposted");
    const alert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dispatch_unposted'`)
      .first<{ value: string }>();
    expect(alert?.value).toContain(`sermon ${rite}`);

    await env.DB.prepare(`INSERT INTO config (key, value) VALUES (?1, 'posted:1')`)
      .bind(`sermon_dispatched_${rite}`).run();
    await alertUnpostedArtifacts(withSecrets, 5_000 + 9 * HOUR);
    expect(await activeAlerts(env.DB)).not.toContain("dispatch_unposted");
    const clearedMarker = await env.DB.prepare(`SELECT value FROM config WHERE key = ?1`)
      .bind(`unposted_seen_sermon_${rite}`).first();
    expect(clearedMarker).toBeNull();
    const clearedAlert = await env.DB.prepare(`SELECT value FROM config WHERE key = 'alert:dispatch_unposted'`).first();
    expect(clearedAlert).toBeNull();
  });

  it("a film-day sermon inside its film window never stamps or alerts", async () => {
    const rite = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"]
      .find((d) => isFilmDay(d))!;
    await env.DB.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       VALUES ('01TESTWATCHDOGFILM000001', 'TONGUE', 'sermon', 's', NULL, ?1, 1000)`
    ).bind(rite).run();
    await env.DB.prepare(
      `INSERT INTO sermon_films (rite_date, video_prompt, created_at) VALUES (?1, 'a prompt', ?2)`
    ).bind(rite, 5_000).run();
    // Well inside FILM_WAIT_MS (6h): sermonFilmGate reads "wait", so this sermon is not yet postable.
    await alertUnpostedArtifacts(withSecrets, 5_000 + 1 * HOUR);
    const marker = await env.DB.prepare(
      `SELECT value FROM config WHERE key = ?1`
    ).bind(`unposted_seen_sermon_${rite}`).first();
    expect(marker).toBeNull();
    expect(await activeAlerts(env.DB)).not.toContain("dispatch_unposted");
  });

  it("the sweep still runs when the send throws — a throwing send IS the silence the watchdog measures", async () => {
    // Neutralize leftover unposted dreams from earlier tests so the dream query in dispatchArtifacts
    // picks up ours, not a sibling test's leftover row.
    await env.DB.prepare("UPDATE dreams SET posted_at = 999 WHERE posted_at IS NULL").run();
    // Clear leftover watchdog state from earlier tests in this describe so this test is hermetic.
    await env.DB.prepare(`DELETE FROM config WHERE key LIKE 'unposted_seen_%'`).run();
    await env.DB.prepare(`DELETE FROM config WHERE key = 'alert:dispatch_unposted'`).run();

    const id = "01TESTWATCHDOGTHROW00001";
    const rite = "2026-09-10";
    await env.DB.prepare(
      `INSERT INTO dreams (id, rite_date, narrative, video_prompt, wakers, status, video_key, created_at)
       VALUES (?1, ?2, 'a dream', 'p', '[]', 'rendered', 'dream/watchdogthrow.mp4', 1000)`
    ).bind(id, rite).run();
    await env.RELICS.put("dream/watchdogthrow.mp4", new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    // Pre-store the dispatch (bypasses composeDispatch, which would hit the live mind and fail) so
    // this test isolates "the send throws" from composition, exactly like the earlier throw tests.
    await storeDispatch(env,
      { kind: "dream", artifactId: id, riteDate: rite, text: "n", filmDay: false },
      "A held line.", null, 2000);
    // uploadVideo hits the real X endpoint with bogus creds and throws -> dispatchArtifacts rethrows.
    // The fix under test: the watchdog sweep must still run in a `finally`, stamping the first-seen
    // marker despite the throw, instead of being skipped by the old sequential end-of-function call.
    await expect(dispatchArtifacts(withSecrets, 3000, Date.now() + 999_999)).rejects.toThrow();
    const marker = await env.DB.prepare(`SELECT value FROM config WHERE key = ?1`)
      .bind(`unposted_seen_${id}`).first<{ value: string }>();
    expect(marker).not.toBeNull();
  });
});
