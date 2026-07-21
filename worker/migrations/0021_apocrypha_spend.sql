-- Add the 'apocrypha' spend category to the ledger's CHECK constraint. budget.ts has always
-- defined an `apocrypha` cap (CAPS_USD) and the public guest-book moderation path (moderation.ts
-- -> askMind category:"apocrypha") reserves against it, but the spend table's CHECK was never
-- extended past ('llm','tts','video'), so every real apocrypha reservation INSERT threw
-- SQLITE_CONSTRAINT before the fetch — surfacing as ModerationUnavailableError -> 503 on EVERY
-- verse submission. The prior tests never caught it: they pin cap:apocrypha=0, which short-circuits
-- reserveEstimate on `estimateUsd > cap` BEFORE the INSERT. SQLite cannot ALTER a CHECK, so the
-- ledger is rebuilt (mirrors 0015's video swap). Existing rows (llm/tts/video) copy over unchanged;
-- no apocrypha rows can exist yet (the bug made them impossible).
CREATE TABLE spend_new (
  day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('llm','tts','video','apocrypha')),
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, category)
);
INSERT INTO spend_new (day, category, usd) SELECT day, category, usd FROM spend;
DROP TABLE spend;
ALTER TABLE spend_new RENAME TO spend;
