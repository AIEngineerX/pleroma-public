-- Add the 'image' spend category to the ledger's CHECK constraint, in the SAME change that adds the
-- cap to budget.ts (CAPS_USD.image) and the standalone-dispatch still that spends against it.
-- 0021 is the cautionary tale: `apocrypha` was defined as a cap and reserved against for days while
-- this CHECK still read ('llm','tts','video'), so every reservation INSERT threw SQLITE_CONSTRAINT
-- and 503'd the whole guest book. A category exists in three places or it does not exist: CAPS_USD,
-- this constraint, and a test that reserves against it for real.
-- SQLite cannot ALTER a CHECK constraint, so the ledger is rebuilt (mirrors 0015 and 0021).
CREATE TABLE spend_new (
  day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('llm','tts','video','image','apocrypha')),
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, category)
);
INSERT INTO spend_new (day, category, usd) SELECT day, category, usd FROM spend;
DROP TABLE spend;
ALTER TABLE spend_new RENAME TO spend;
