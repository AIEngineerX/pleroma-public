-- The explicit, Maker-controlled ignition switch. '0' until the launch minute, when the Maker sets it to
-- '1' in the same action that sets PULSE_MINT (anti-decoy: the site can only ever go live with the real mint).
INSERT INTO config (key, value) VALUES ('launched', '0') ON CONFLICT(key) DO NOTHING;
