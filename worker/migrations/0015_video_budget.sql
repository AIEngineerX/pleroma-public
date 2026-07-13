-- Add the 'video' spend category (G1: DREAM video render is a budgeted, capped vendor call like llm/tts).
-- SQLite cannot ALTER a CHECK constraint, so the spend ledger is rebuilt (mirrors 0014's dreams swap).
CREATE TABLE spend_new (
  day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('llm','tts','video')),
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, category)
);
INSERT INTO spend_new (day, category, usd) SELECT day, category, usd FROM spend;
DROP TABLE spend;
ALTER TABLE spend_new RENAME TO spend;
