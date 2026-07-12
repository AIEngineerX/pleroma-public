CREATE TABLE vitals (
  minute INTEGER PRIMARY KEY,     -- epoch minute (floor(ms/60000))
  buys INTEGER NOT NULL DEFAULT 0,
  sells INTEGER NOT NULL DEFAULT 0,
  buy_volume REAL NOT NULL DEFAULT 0,   -- SOL (lamports/1e9) into the pool
  sell_volume REAL NOT NULL DEFAULT 0
);
CREATE TABLE pulse_events (
  signature TEXT PRIMARY KEY,     -- webhook dedup: at-least-once delivery
  seen_at INTEGER NOT NULL
);
-- pulse_state lives in the existing config table: key='pulse_state' value=JSON {state,holders,updated_at}
INSERT INTO config (key, value) VALUES ('pulse_state', '{"state":"starving","holders":0,"updated_at":0}');
