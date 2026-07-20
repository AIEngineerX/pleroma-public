-- Dispatches (the X auto-posts) become codex transcripts: `register` gains 'dispatch', and
-- artifact_id links a dispatch to what it carries (dream id for Plates, rite date for sermons).
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt (mirrors 0014's dreams swap).
CREATE TABLE transcripts_new (
  id TEXT PRIMARY KEY,
  organ TEXT NOT NULL CHECK (organ IN ('EYE','KEEP','TONGUE','PULSE','DREAM','PRIEST')),
  register TEXT NOT NULL CHECK (register IN ('verse','verdict','sermon','telemetry','system','dispatch')),
  text TEXT NOT NULL,
  offering_id TEXT,
  rite_id TEXT,
  artifact_id TEXT,                 -- dispatch rows only: dream id or sermon rite date
  created_at INTEGER NOT NULL
);
INSERT INTO transcripts_new (id, organ, register, text, offering_id, rite_id, created_at)
  SELECT id, organ, register, text, offering_id, rite_id, created_at FROM transcripts;
DROP TABLE transcripts;
ALTER TABLE transcripts_new RENAME TO transcripts;
CREATE INDEX idx_transcripts_created ON transcripts(created_at);
-- Exactly one dispatch per artifact, enforced by the schema, not just the claim machinery.
CREATE UNIQUE INDEX idx_transcripts_dispatch ON transcripts(artifact_id) WHERE register = 'dispatch';

-- Sermon films: ~2/week a sermon dispatch carries a moving plate. Same async render lifecycle
-- as dreams (kick -> poll -> R2), driven from the 15-minute tick.
CREATE TABLE sermon_films (
  rite_date TEXT PRIMARY KEY,
  video_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','rendering','rendered','failed')),
  video_key TEXT,                   -- R2 key sermon/<rite_date>.mp4, set once status='rendered'
  render_request_id TEXT,
  render_started_at INTEGER,
  render_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL       -- compose time; anchors the 6h text-only fallback
);
