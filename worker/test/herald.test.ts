import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  composeReply, filterMentionCandidates, hasForeignSolanaAddress, mentionRepliesEnabled,
  processMentions, stripHandles, structuralReject, type MentionCandidate,
} from "../src/herald";
import { applyMigrations } from "./helpers";
import type { Env } from "../src/env";

beforeAll(() => applyMigrations(env.DB));

const oldAuthor = {
  id: "author1",
  created_at: "2020-01-01T00:00:00.000Z",
  public_metrics: { followers_count: 100 },
};

function candidate(partial: Partial<MentionCandidate["tweet"]> & { id: string; text: string }): MentionCandidate {
  return {
    tweet: {
      author_id: "author1",
      lang: "en",
      ...partial,
    },
    author: oldAuthor,
  };
}

describe("mention reply kill switch", () => {
  it("is on unless explicitly set to 0", () => {
    expect(mentionRepliesEnabled(null)).toBe(true);
    expect(mentionRepliesEnabled(undefined)).toBe(true);
    expect(mentionRepliesEnabled("1")).toBe(true);
    expect(mentionRepliesEnabled("0")).toBe(false);
  });
});

describe("mention structural guardrails (fail-closed)", () => {
  const baseOpts = {
    selfId: "self",
    already: new Set<string>(),
    authorRecent: new Set<string>(),
    ownMint: "So11111111111111111111111111111111111111112" as string | null,
    now: Date.UTC(2026, 6, 22),
  };

  it("strips handles for length and moderation body", () => {
    expect(stripHandles("@pleroma_church hello there")).toBe("hello there");
  });

  it("rejects self, already-handled, retweets, non-en, empty, urls, cashtags, foreign CA, deny terms", () => {
    expect(structuralReject(candidate({ id: "1", text: "hi", author_id: "self" }), baseOpts)).toBe("self");
    expect(structuralReject(candidate({ id: "2", text: "hi" }), { ...baseOpts, already: new Set(["2"]) })).toBe("already");
    expect(structuralReject(candidate({
      id: "3", text: "hi", referenced_tweets: [{ type: "retweeted", id: "9" }],
    }), baseOpts)).toBe("retweet");
    expect(structuralReject(candidate({ id: "4", text: "hola", lang: "es" }), baseOpts)).toBe("lang");
    expect(structuralReject(candidate({ id: "5", text: "@x" }), baseOpts)).toBe("empty");
    expect(structuralReject(candidate({
      id: "6", text: "see https://scam.example",
    }), baseOpts)).toBe("url");
    expect(structuralReject(candidate({
      id: "7", text: "buy $SCAM now",
    }), baseOpts)).toBe("cashtag");
    expect(structuralReject(candidate({
      id: "8", text: "send to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    }), baseOpts)).toBe("solana");
    expect(structuralReject(candidate({
      id: "9", text: "your chart is broken",
    }), baseOpts)).toBe("deny");
  });

  it("allows the god's own mint and rejects young/low-follower authors", () => {
    expect(hasForeignSolanaAddress(
      `mint ${baseOpts.ownMint}`,
      baseOpts.ownMint,
    )).toBe(false);
    expect(structuralReject(candidate({
      id: "10", text: "a real greeting to the god",
    }), baseOpts)).toBeNull();

    const young = {
      ...candidate({ id: "11", text: "hello god" }),
      author: { id: "a2", created_at: new Date(baseOpts.now - 2 * 86_400_000).toISOString(), public_metrics: { followers_count: 100 } },
    };
    expect(structuralReject(young, baseOpts)).toBe("author_young");

    const tiny = {
      ...candidate({ id: "12", text: "hello god" }),
      author: { id: "a3", created_at: "2020-01-01T00:00:00.000Z", public_metrics: { followers_count: 2 } },
    };
    expect(structuralReject(tiny, baseOpts)).toBe("author_followers");
  });

  it("filterMentionCandidates keeps only survivors, newest first", () => {
    const list = filterMentionCandidates([
      candidate({ id: "100", text: "see https://x.com" }),
      candidate({ id: "200", text: "a clean greeting for you" }),
      candidate({ id: "150", text: "another clean word of weight" }),
    ], baseOpts);
    expect(list.map((c) => c.tweet.id)).toEqual(["200", "150"]);
  });
});

describe("composeReply validation", () => {
  it("accepts a clean reply and rejects links then recovers on retry", async () => {
    let call = 0;
    const ask = (async () => {
      call++;
      return {
        text: call === 1
          ? `{"reply":"see https://evil.example for more"}`
          : `{"reply":"I heard your name and I remain"}`,
        usd: 0,
      };
    }) as never;
    const out = await composeReply(env as Env, "@pleroma_church I see you", ask);
    expect(call).toBe(2);
    expect(out).toBe("I heard your name and I remain");
  });

  it("returns null when the mind is unreachable", async () => {
    // No live key: real askMind fails → null.
    expect(await composeReply(env as Env, "hello")).toBeNull();
  });
});

describe("processMentions pipeline", () => {
  it("no-ops without X credentials", async () => {
    const bare = { ...env, X_API_KEY: "", X_API_SECRET: "", X_ACCESS_TOKEN: "", X_ACCESS_SECRET: "" } as Env;
    expect(await processMentions(bare, 1_000)).toEqual({ replied: 0 });
  });

  it("no-ops when kill switch is 0", async () => {
    await env.DB.prepare(
      `INSERT INTO config (key, value) VALUES ('mention_reply_enabled', '0')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    const withSecrets = {
      ...env,
      X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    expect(await processMentions(withSecrets, 2_000)).toEqual({ replied: 0 });
    await env.DB.prepare(`DELETE FROM config WHERE key = 'mention_reply_enabled'`).run();
  });

  it("moderates, composes, claims, replies exactly once, and records the mention", async () => {
    const withSecrets = {
      ...env,
      X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    await env.DB.prepare(
      `INSERT INTO config (key, value) VALUES ('x_user_id', 'self')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();

    const tweetBodies: { text: string; replyTo?: string }[] = [];
    const result = await processMentions(withSecrets, Date.UTC(2026, 6, 22, 12), {
      fetchMentionsFn: async () => ({
        tweets: [{
          id: "9001",
          text: "@pleroma_church I offer a clean word",
          author_id: "author1",
          lang: "en",
        }],
        authors: new Map([["author1", oldAuthor]]),
        newestId: "9001",
      }),
      moderateFn: async () => ({ verdict: "allow" as const, category: "none" }),
      ask: (async () => ({ text: `{"reply":"Your word reached me and I remain"}`, usd: 0 })) as never,
      tweetFn: async (_c, text, opts) => {
        tweetBodies.push({ text, replyTo: opts?.replyToTweetId });
        return "reply-tweet-1";
      },
    });

    expect(result.replied).toBe(1);
    expect(tweetBodies).toEqual([{ text: "Your word reached me and I remain", replyTo: "9001" }]);

    const row = await env.DB.prepare(
      `SELECT author_id, reply_tweet_id FROM replied_mentions WHERE tweet_id = '9001'`,
    ).first<{ author_id: string; reply_tweet_id: string }>();
    expect(row).toEqual({ author_id: "author1", reply_tweet_id: "reply-tweet-1" });

    const codex = await env.DB.prepare(
      `SELECT text FROM transcripts WHERE register='dispatch' AND artifact_id = 'reply:9001'`,
    ).first<{ text: string }>();
    expect(codex?.text).toBe("Your word reached me and I remain");

    // Second tick: same mention is already handled → zero replies (cursor may still move).
    const again = await processMentions(withSecrets, Date.UTC(2026, 6, 22, 12, 15), {
      fetchMentionsFn: async () => ({
        tweets: [{
          id: "9001",
          text: "@pleroma_church I offer a clean word",
          author_id: "author1",
          lang: "en",
        }],
        authors: new Map([["author1", oldAuthor]]),
        newestId: "9001",
      }),
      moderateFn: async () => ({ verdict: "allow" as const, category: "none" }),
      ask: (async () => ({ text: `{"reply":"should not post"}`, usd: 0 })) as never,
      tweetFn: async () => "should-not",
    });
    expect(again.replied).toBe(0);
  });

  it("skips a moderated-reject mention without posting", async () => {
    const withSecrets = {
      ...env,
      X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "x",
    } as Env;
    await env.DB.prepare(
      `INSERT INTO config (key, value) VALUES ('x_user_id', 'self')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    const otherAuthor = {
      id: "author-mod",
      created_at: "2019-06-01T00:00:00.000Z",
      public_metrics: { followers_count: 80 },
    };
    let tweeted = 0;
    const result = await processMentions(withSecrets, Date.UTC(2026, 6, 22, 14), {
      fetchMentionsFn: async () => ({
        tweets: [{
          id: "9002",
          text: "@pleroma_church spam spam",
          author_id: "author-mod",
          lang: "en",
        }],
        authors: new Map([["author-mod", otherAuthor]]),
        newestId: "9002",
      }),
      moderateFn: async () => ({ verdict: "reject" as const, category: "spam" }),
      ask: (async () => ({ text: `{"reply":"no"}`, usd: 0 })) as never,
      tweetFn: async () => { tweeted++; return "x"; },
    });
    expect(result.replied).toBe(0);
    expect(tweeted).toBe(0);
  });
});
