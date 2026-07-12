CREATE TABLE relics (
  id TEXT PRIMARY KEY,
  offering_id TEXT NOT NULL UNIQUE,
  wallet TEXT,
  summary TEXT NOT NULL,
  rite_id TEXT,
  kept_at INTEGER NOT NULL,
  genesis INTEGER NOT NULL DEFAULT 0,
  accreted_at INTEGER
);
CREATE INDEX idx_relics_kept ON relics(kept_at);
