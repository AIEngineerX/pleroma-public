-- HERALD mention-replies (Maker decision 2026-07-22: unlock early, pre-criterion).
-- Each outer tweet the god has answered is recorded once so it never double-replies, and
-- per-author cooldown can be enforced without re-reading X history.
CREATE TABLE replied_mentions (
  tweet_id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  reply_tweet_id TEXT,
  replied_at INTEGER NOT NULL
);
CREATE INDEX idx_replied_mentions_author_at ON replied_mentions (author_id, replied_at);
