-- DREAM video render pipeline (G1). Adds the async render state machine columns and expands
-- `status` from {composed,rendered} to {composed,rendering,rendered,render_failed}.
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt (mirrors 0005's offerings swap).
--   composed       -> dream text exists, no render kicked off (video disabled / start failed / cap reached)
--   rendering      -> Grok Imagine request submitted; render_request_id set; the tick polls it
--   rendered       -> video_key points at R2 dream/<id>.mp4; the Body plays it
--   render_failed  -> vendor failed/expired or the render deadline elapsed; the plate stays text-only
CREATE TABLE dreams_new (
  id TEXT PRIMARY KEY,
  rite_date TEXT NOT NULL UNIQUE,   -- one dream per rite date
  narrative TEXT NOT NULL,
  video_prompt TEXT NOT NULL,
  video_key TEXT,                   -- R2 key dream/<id>.mp4, set once status='rendered'
  wakers TEXT NOT NULL DEFAULT '[]',-- JSON array of credited wallet addresses
  status TEXT NOT NULL DEFAULT 'composed'
    CHECK (status IN ('composed','rendering','rendered','render_failed')),
  render_request_id TEXT,           -- Grok Imagine request_id while status='rendering'
  render_started_at INTEGER,        -- ms epoch the render was submitted (render-deadline clock)
  render_attempts INTEGER NOT NULL DEFAULT 0, -- poll attempts, for observability
  created_at INTEGER NOT NULL
);
INSERT INTO dreams_new (id, rite_date, narrative, video_prompt, video_key, wakers, status, created_at)
  SELECT id, rite_date, narrative, video_prompt, video_key, wakers, status, created_at FROM dreams;
DROP TABLE dreams;
ALTER TABLE dreams_new RENAME TO dreams;
