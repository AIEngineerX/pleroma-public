-- Apocrypha: verses written by Wakers, not by the god; kept separate from the Canon
-- (DOCTRINE.md Lexicon). Anonymous-only for v1 -- no wallet attribution, no signature
-- verification, since a free-text wallet field would let anyone falsely attribute a verse to
-- someone else's address. Moderated synchronously at submission (moderateText, moderation.ts);
-- rejected text is never stored, matching the offering pipeline's own fail-closed stance.
CREATE TABLE apocrypha (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_apocrypha_created ON apocrypha(created_at);
