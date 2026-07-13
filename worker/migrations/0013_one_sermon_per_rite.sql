-- Backstop for the one-sermon-per-rite invariant (worker/src/db.ts publishSermon). The rite lock prevents
-- CONCURRENT double-compose in the common case, but the lease has no fencing token (lock.ts), so a lease
-- overrun or a resumed partial run could otherwise let two TONGUE/sermon transcripts land for one rite —
-- publishing edited/duplicated scripture, which the integrity invariant forbids. The guarded
-- INSERT ... WHERE NOT EXISTS is the primary guard; this partial UNIQUE index is the hard backstop (same
-- belt-and-suspenders as the relics UNIQUE(offering_id)).
CREATE UNIQUE INDEX transcripts_one_sermon_per_rite ON transcripts (rite_id) WHERE register = 'sermon' AND organ = 'TONGUE';
