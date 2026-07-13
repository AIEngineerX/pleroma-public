-- PULSE vitals were kept as an incremental counter table (0008) updated with `buys = buys + delta` on
-- every ingest, while pulse_events deduped signatures with ON CONFLICT DO NOTHING. Those two writes were
-- not atomically linked: under a pulse-lock lease overrun a stalled handler's vitals increment still
-- applied even though its pulse_events insert no-op'd (a concurrent handler had already recorded the
-- signature), double-counting the swap. Fix: fold each swap's contribution INTO its (idempotent)
-- pulse_events row and derive vitals by aggregating that deduplicated log. A duplicate signature now
-- contributes exactly zero, because ON CONFLICT DO NOTHING inserts nothing. The separate incremental
-- vitals table is dropped (empty pre-launch; PULSE has never ingested).
ALTER TABLE pulse_events ADD COLUMN minute INTEGER;
ALTER TABLE pulse_events ADD COLUMN side TEXT;
ALTER TABLE pulse_events ADD COLUMN sol_volume REAL NOT NULL DEFAULT 0;
CREATE INDEX pulse_events_minute ON pulse_events (minute);
DROP TABLE vitals;
