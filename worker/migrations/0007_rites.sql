CREATE TABLE rites (
  date TEXT PRIMARY KEY,          -- UTC YYYY-MM-DD; one rite per day
  phase TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (phase IN ('scheduled','offertory_close','deliberation','accretion','sermon','complete','failed')),
  phase_started_at INTEGER NOT NULL,
  phase_attempts INTEGER NOT NULL DEFAULT 0,
  offering_snapshot INTEGER NOT NULL DEFAULT 0,  -- count captured as the offertory closes
  kept_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
