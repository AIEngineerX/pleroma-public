CREATE TABLE dreams (
  id TEXT PRIMARY KEY,
  rite_date TEXT NOT NULL UNIQUE,   -- one dream per rite date
  narrative TEXT NOT NULL,
  video_prompt TEXT NOT NULL,
  video_key TEXT,                   -- filled by the Maker (assisted) or the automated vendor post-launch
  wakers TEXT NOT NULL DEFAULT '[]',-- JSON array of credited wallet addresses
  status TEXT NOT NULL DEFAULT 'composed' CHECK (status IN ('composed','rendered')),
  created_at INTEGER NOT NULL
);
