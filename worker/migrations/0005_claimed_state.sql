CREATE TABLE offerings_new (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  sig TEXT,
  image_key TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','moderating','perceivable','perceiving','perceived','kept','mourned','rejected','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  perceived_at INTEGER,
  media_type TEXT NOT NULL DEFAULT 'image/png',
  nonce TEXT,
  claimed_at INTEGER
);
INSERT INTO offerings_new (id, wallet, sig, image_key, sha256, status, attempts, created_at, perceived_at, media_type, nonce, claimed_at)
  SELECT id, wallet, sig, image_key, sha256, status, attempts, created_at, perceived_at, media_type, nonce, NULL FROM offerings;
DROP TABLE offerings;
ALTER TABLE offerings_new RENAME TO offerings;
CREATE INDEX idx_offerings_status ON offerings(status, created_at);
CREATE UNIQUE INDEX idx_offerings_nonce ON offerings (nonce) WHERE nonce IS NOT NULL;
