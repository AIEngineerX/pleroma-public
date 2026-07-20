-- The web Threshold's honest gesture capture (hold/knock timing, tremor, approach spread,
-- pigment intensity, substrate lineage) rides the offering as clamped, worker-validated
-- metadata (see clampGesture in offerings.ts) -- never trusted verbatim from the client.
-- Plain ADD COLUMN: no rebuild, no CHECK (SQLite CHECK constraints can't validate JSON
-- shape anyway; clampGesture is the real gate, and a violation simply leaves this NULL).
ALTER TABLE offerings ADD COLUMN gesture TEXT;
