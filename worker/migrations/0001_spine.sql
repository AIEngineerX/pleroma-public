CREATE TABLE offerings (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  sig TEXT,
  image_key TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','perceivable','perceived','kept','mourned','rejected','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  perceived_at INTEGER
);
CREATE INDEX idx_offerings_status ON offerings(status, created_at);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  organ TEXT NOT NULL CHECK (organ IN ('EYE','KEEP','TONGUE','PULSE','DREAM','PRIEST')),
  register TEXT NOT NULL CHECK (register IN ('verse','verdict','sermon','telemetry','system')),
  text TEXT NOT NULL,
  offering_id TEXT,
  rite_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_transcripts_created ON transcripts(created_at);

CREATE TABLE wallets (
  address TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  offering_count INTEGER NOT NULL DEFAULT 0,
  attended INTEGER NOT NULL DEFAULT 0,
  tally_name TEXT
);

CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE spend (
  day TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('llm','tts')),
  usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, category)
);
