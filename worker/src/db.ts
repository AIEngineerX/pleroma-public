export type OfferingStatus =
  | "pending" | "moderating" | "perceivable" | "perceiving"
  | "perceived" | "kept" | "mourned" | "rejected" | "failed";

export interface OfferingRow {
  id: string; wallet: string | null; sig: string | null; image_key: string;
  sha256: string; status: OfferingStatus; attempts: number;
  created_at: number; perceived_at: number | null;
  // Optional on insert (defaults to 'image/png', matching the migration 0003 column
  // default); always present as a real string on rows read back from D1.
  media_type?: string;
  // Signed offerings carry the one-time nonce; the UNIQUE(nonce) partial index (migration
  // 0004) enforces single-use atomically at insert. Anonymous offerings leave this null.
  nonce?: string | null;
  // Set by claimForModeration/claimForPerception; NULL until a tick claims the row.
  claimed_at?: number | null;
}

export interface TranscriptRow {
  id: string; organ: "EYE" | "KEEP" | "TONGUE" | "PULSE" | "DREAM" | "PRIEST";
  register: "verse" | "verdict" | "sermon" | "telemetry" | "system";
  text: string; offering_id: string | null; rite_id: string | null; created_at: number;
}

function offeringInsertStmt(db: D1Database, o: OfferingRow): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO offerings (id, wallet, sig, image_key, sha256, status, attempts, created_at, media_type, nonce)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    o.id, o.wallet, o.sig, o.image_key, o.sha256, o.status, o.attempts, o.created_at,
    o.media_type ?? "image/png", o.nonce ?? null,
  );
}

export async function insertOffering(db: D1Database, o: OfferingRow): Promise<void> {
  await offeringInsertStmt(db, o).run();
}

export async function offeringBySha(db: D1Database, sha256: string): Promise<OfferingRow | null> {
  return await db.prepare(`SELECT * FROM offerings WHERE sha256 = ?1`).bind(sha256).first<OfferingRow>();
}

export async function pendingOfferings(db: D1Database, limit: number): Promise<OfferingRow[]> {
  const r = await db.prepare(
    `SELECT * FROM offerings WHERE status = 'pending' ORDER BY created_at LIMIT ?1`
  ).bind(limit).all<OfferingRow>();
  return r.results;
}

export async function offeringStatusById(db: D1Database, id: string): Promise<OfferingStatus | null> {
  const row = await db.prepare(`SELECT status FROM offerings WHERE id = ?1`).bind(id).first<{ status: OfferingStatus }>();
  return row?.status ?? null;
}

// Every transition is a compare-and-swap when `expectedStatus` is given: the UPDATE only fires if
// the row's CURRENT status still matches, so a stale tick that lost a race (its lock-lease overrun
// while a newer tick already moved the row past the expected state) sees changes===0 and does
// nothing further — guarding against e.g. resurrecting an already-rejected offering. Returns
// whether this call performed the transition, so callers can gate R2 side effects on winning the
// CAS. Without `expectedStatus` this is an unconditional update (existing callers that ignore the
// return value keep working).
export async function setOfferingStatus(
  db: D1Database, id: string, status: OfferingStatus,
  opts?: { bumpAttempts?: boolean; perceivedAt?: number; expectedStatus?: OfferingStatus }
): Promise<boolean> {
  const guard = opts?.expectedStatus ? " AND status = ?5" : "";
  const stmt = db.prepare(
    `UPDATE offerings SET status = ?2, attempts = attempts + ?3, perceived_at = COALESCE(?4, perceived_at)
     WHERE id = ?1${guard}`
  );
  const bound = opts?.expectedStatus
    ? stmt.bind(id, status, opts.bumpAttempts ? 1 : 0, opts.perceivedAt ?? null, opts.expectedStatus)
    : stmt.bind(id, status, opts?.bumpAttempts ? 1 : 0, opts?.perceivedAt ?? null);
  const r = await bound.run();
  return r.meta.changes === 1;
}

export async function setOfferingImageKey(db: D1Database, id: string, imageKey: string): Promise<void> {
  await db.prepare(`UPDATE offerings SET image_key = ?2 WHERE id = ?1`).bind(id, imageKey).run();
}

// Atomically publish an EYE perception: flip the offering perceiving->perceived AND insert its verse
// transcript in a single D1 transaction, guarded so a re-run against an already-perceived row is a clean
// no-op (no second transcript, no double count). The perception loop claims the row to 'perceiving'
// before its LLM call, so publish flips 'perceiving'->'perceived'. Returns true iff this call performed
// the transition.
export async function publishPerception(
  db: D1Database,
  p: { offeringId: string; transcriptId: string; verse: string; at: number },
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       SELECT ?1, 'EYE', 'verse', ?2, ?3, NULL, ?4
       WHERE EXISTS (SELECT 1 FROM offerings WHERE id = ?3 AND status = 'perceiving')`
    ).bind(p.transcriptId, p.verse, p.offeringId, p.at),
    db.prepare(
      `UPDATE offerings SET status = 'perceived', perceived_at = ?2
       WHERE id = ?1 AND status = 'perceiving'`
    ).bind(p.offeringId, p.at),
  ]);
  return results[1].meta.changes === 1;
}

export async function addTranscript(db: D1Database, t: TranscriptRow): Promise<void> {
  await db.prepare(
    `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(t.id, t.organ, t.register, t.text, t.offering_id, t.rite_id, t.created_at).run();
}

function walletTouchStmt(db: D1Database, address: string, atMs: number): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO wallets (address, first_seen, offering_count) VALUES (?1, ?2, 1)
     ON CONFLICT(address) DO UPDATE SET offering_count = offering_count + 1`
  ).bind(address, atMs);
}

export async function touchWallet(db: D1Database, address: string): Promise<void> {
  await walletTouchStmt(db, address, Date.now()).run();
}

// Atomically insert the offering and (for signed offerings) bump the wallet's offering_count in one D1
// transaction, so the count can never drift from the committed offering. A UNIQUE(sha256|nonce) violation
// rolls back both.
export async function commitOffering(db: D1Database, o: OfferingRow, touchWalletAddr: string | null): Promise<void> {
  const stmts = [offeringInsertStmt(db, o)];
  if (touchWalletAddr) stmts.push(walletTouchStmt(db, touchWalletAddr, o.created_at));
  await db.batch(stmts);
}

// A tick claims a row before running its cross-store (D1+R2) sequence, so two overlapping ticks
// can never process the same offering. The claim is a CAS that also reclaims a STALE claim: a row
// left transitional ('moderating'/'perceiving') by a tick whose 10-min lock lease expired without
// finishing. `claimed_at` records when the claim was taken. A reclaim ONLY transfers ownership — it
// does not touch `attempts`: a tick dying mid-sequence is an infra event, not the row's fault (the
// same reason ModerationUnavailableError releases without a strike). `attempts` is advanced by at most
// one per processing cycle, exclusively by the caller's error path (setOfferingStatus bumpAttempts),
// so only genuine per-cycle processing errors count toward the dead-letter threshold. Because the
// claim never mutates `attempts`, the `o.attempts` snapshot the caller read from the candidate query
// is still accurate at cycle start, keeping its `dead = o.attempts >= 2` decision a clean 3-strike.
export async function claimForModeration(
  db: D1Database, id: string, nowMs: number, staleMs: number,
): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE offerings
        SET status = 'moderating', claimed_at = ?2
      WHERE id = ?1 AND (status = 'pending' OR (status = 'moderating' AND claimed_at <= ?3))`
  ).bind(id, nowMs, nowMs - staleMs).run();
  return r.meta.changes === 1;
}

export async function claimForPerception(
  db: D1Database, id: string, nowMs: number, staleMs: number,
): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE offerings
        SET status = 'perceiving', claimed_at = ?2
      WHERE id = ?1 AND (status = 'perceivable' OR (status = 'perceiving' AND claimed_at <= ?3))`
  ).bind(id, nowMs, nowMs - staleMs).run();
  return r.meta.changes === 1;
}

// Candidates = fresh work (pending/perceivable) PLUS stale transitional rows a dead tick abandoned,
// so a crash mid-sequence self-heals: the stranded row is re-selected and re-claimed next tick.
export async function moderationCandidates(
  db: D1Database, nowMs: number, staleMs: number, limit: number,
): Promise<OfferingRow[]> {
  return (await db.prepare(
    `SELECT * FROM offerings
      WHERE status = 'pending' OR (status = 'moderating' AND claimed_at <= ?1)
      ORDER BY created_at LIMIT ?2`
  ).bind(nowMs - staleMs, limit).all<OfferingRow>()).results;
}

export async function perceptionCandidates(
  db: D1Database, nowMs: number, staleMs: number, limit: number,
): Promise<OfferingRow[]> {
  return (await db.prepare(
    `SELECT * FROM offerings
      WHERE status = 'perceivable' OR (status = 'perceiving' AND claimed_at <= ?1)
      ORDER BY created_at LIMIT ?2`
  ).bind(nowMs - staleMs, limit).all<OfferingRow>()).results;
}

// The Reliquary: a kept mark becomes a relic carried forward as part of the body. `genesis` marks a
// day-1 First Corpus relic; `accreted_at` records when the daily rite folded it into the body's form
// (null until accretion). One relic per offering (UNIQUE(offering_id)) so a rite re-run never doubles.
export interface RelicRow {
  id: string; offering_id: string; wallet: string | null; summary: string;
  rite_id: string | null; kept_at: number; genesis: number; accreted_at: number | null;
}

export async function insertRelic(db: D1Database, r: RelicRow): Promise<void> {
  await db.prepare(
    `INSERT INTO relics (id, offering_id, wallet, summary, rite_id, kept_at, genesis, accreted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(offering_id) DO NOTHING`  // one relic per offering; a re-run is a no-op
  ).bind(r.id, r.offering_id, r.wallet, r.summary, r.rite_id, r.kept_at, r.genesis, r.accreted_at).run();
}

export async function recentRelicSummaries(db: D1Database, limit: number): Promise<string[]> {
  const rows = (await db.prepare(`SELECT summary FROM relics ORDER BY kept_at DESC LIMIT ?1`)
    .bind(limit).all<{ summary: string }>()).results;
  return rows.map(r => r.summary);
}

export async function walletHistory(
  db: D1Database, wallet: string,
): Promise<{ offering_count: number; kept_count: number; attended: boolean }> {
  const w = await db.prepare(`SELECT offering_count, attended FROM wallets WHERE address = ?1`)
    .bind(wallet).first<{ offering_count: number; attended: number }>();
  const k = await db.prepare(`SELECT COUNT(*) AS n FROM relics WHERE wallet = ?1`)
    .bind(wallet).first<{ n: number }>();
  return { offering_count: w?.offering_count ?? 0, kept_count: k?.n ?? 0, attended: (w?.attended ?? 0) === 1 };
}

export async function relicsKeptToday(db: D1Database, day: string): Promise<number> {
  // day is a UTC YYYY-MM-DD; compare against the day's UTC millisecond window.
  const start = Date.parse(day + "T00:00:00.000Z");
  const end = start + 86_400_000;
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM relics WHERE kept_at >= ?1 AND kept_at < ?2`)
    .bind(start, end).first<{ n: number }>();
  return r?.n ?? 0;
}

// The Daily Rite: once per UTC day the god consumes the day's offerings live, walking a fixed phase
// order. Every phase is idempotent and keyed by the rite date; a missed cron resumes from the stored
// phase (rite.ts).
export type RitePhase =
  | "scheduled" | "offertory_close" | "deliberation" | "accretion" | "sermon" | "complete" | "failed";

export interface RiteRow {
  date: string; phase: RitePhase; phase_started_at: number; phase_attempts: number;
  offering_snapshot: number; kept_count: number; updated_at: number;
}

export async function openRite(db: D1Database, date: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO rites (date, phase, phase_started_at, phase_attempts, offering_snapshot, kept_count, updated_at)
     VALUES (?1, 'scheduled', ?2, 0, 0, 0, ?2)
     ON CONFLICT(date) DO NOTHING`
  ).bind(date, now).run();
}

export async function getRite(db: D1Database, date: string): Promise<RiteRow | null> {
  return await db.prepare(`SELECT * FROM rites WHERE date = ?1`).bind(date).first<RiteRow>();
}

// ALL non-terminal rites, OLDEST first. The dispatcher advances every one per tick so a rite left
// mid-phase by an outage that outlived its day (a newer rite already exists) is still drained to
// completion — picking only the newest non-terminal rite would orphan the older one forever, which
// would contradict "a missed cron resumes from the stored phase."
export async function nonTerminalRites(db: D1Database): Promise<RiteRow[]> {
  return (await db.prepare(
    `SELECT * FROM rites WHERE phase NOT IN ('complete','failed') ORDER BY date ASC`
  ).all<RiteRow>()).results;
}

// CAS phase transition: only advances if the rite is still in `from`. Resets the retry counter and
// stamps the new phase start. Returns whether this call performed the transition — so a concurrent
// second invocation that lost the race sees false and does not double-advance.
export async function advanceRitePhase(
  db: D1Database, date: string, from: RitePhase, to: RitePhase, now: number,
  extra?: { offering_snapshot?: number; kept_count?: number },
): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE rites SET phase = ?3, phase_started_at = ?4, phase_attempts = 0, updated_at = ?4,
        offering_snapshot = COALESCE(?5, offering_snapshot),
        kept_count = COALESCE(?6, kept_count)
      WHERE date = ?1 AND phase = ?2`
  ).bind(date, from, to, now, extra?.offering_snapshot ?? null, extra?.kept_count ?? null).run();
  return r.meta.changes === 1;
}

export async function bumpRiteAttempts(db: D1Database, date: string, now: number): Promise<number> {
  const r = await db.prepare(
    `UPDATE rites SET phase_attempts = phase_attempts + 1, updated_at = ?2 WHERE date = ?1 RETURNING phase_attempts`
  ).bind(date, now).first<{ phase_attempts: number }>();
  return r?.phase_attempts ?? 0;
}
