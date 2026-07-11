export type OfferingStatus =
  | "pending" | "perceivable" | "perceived" | "kept" | "mourned" | "rejected" | "failed";

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

export async function setOfferingStatus(
  db: D1Database, id: string, status: OfferingStatus,
  opts?: { bumpAttempts?: boolean; perceivedAt?: number }
): Promise<void> {
  await db.prepare(
    `UPDATE offerings SET status = ?2,
       attempts = attempts + ?3,
       perceived_at = COALESCE(?4, perceived_at)
     WHERE id = ?1`
  ).bind(id, status, opts?.bumpAttempts ? 1 : 0, opts?.perceivedAt ?? null).run();
}

export async function setOfferingImageKey(db: D1Database, id: string, imageKey: string): Promise<void> {
  await db.prepare(`UPDATE offerings SET image_key = ?2 WHERE id = ?1`).bind(id, imageKey).run();
}

// Atomically publish an EYE perception: flip the offering perceivable->perceived AND insert its verse
// transcript in a single D1 transaction, guarded so a re-run against an already-perceived row is a clean
// no-op (no second transcript, no double count). Returns true iff this call performed the transition.
export async function publishPerception(
  db: D1Database,
  p: { offeringId: string; transcriptId: string; verse: string; at: number },
): Promise<boolean> {
  const results = await db.batch([
    db.prepare(
      `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
       SELECT ?1, 'EYE', 'verse', ?2, ?3, NULL, ?4
       WHERE EXISTS (SELECT 1 FROM offerings WHERE id = ?3 AND status = 'perceivable')`
    ).bind(p.transcriptId, p.verse, p.offeringId, p.at),
    db.prepare(
      `UPDATE offerings SET status = 'perceived', perceived_at = ?2
       WHERE id = ?1 AND status = 'perceivable'`
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
