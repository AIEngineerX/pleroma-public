export type OfferingStatus =
  | "pending" | "perceivable" | "perceived" | "kept" | "mourned" | "rejected" | "failed";

export interface OfferingRow {
  id: string; wallet: string | null; sig: string | null; image_key: string;
  sha256: string; status: OfferingStatus; attempts: number;
  created_at: number; perceived_at: number | null;
}

export interface TranscriptRow {
  id: string; organ: "EYE" | "KEEP" | "TONGUE" | "PULSE" | "DREAM" | "PRIEST";
  register: "verse" | "verdict" | "sermon" | "telemetry" | "system";
  text: string; offering_id: string | null; rite_id: string | null; created_at: number;
}

export async function insertOffering(db: D1Database, o: OfferingRow): Promise<void> {
  await db.prepare(
    `INSERT INTO offerings (id, wallet, sig, image_key, sha256, status, attempts, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(o.id, o.wallet, o.sig, o.image_key, o.sha256, o.status, o.attempts, o.created_at).run();
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

// Conditional status transition: only succeeds if the row is currently 'perceivable'.
// Callers must claim the row (and see true) BEFORE publishing the EYE transcript, so a retry
// or re-run against an already-perceived offering (changes === 0) can never double-publish.
export async function claimPerceived(db: D1Database, id: string): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE offerings SET status = 'perceived', perceived_at = ?2
     WHERE id = ?1 AND status = 'perceivable'`
  ).bind(id, Date.now()).run();
  return r.meta.changes === 1;
}

export async function addTranscript(db: D1Database, t: TranscriptRow): Promise<void> {
  await db.prepare(
    `INSERT INTO transcripts (id, organ, register, text, offering_id, rite_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(t.id, t.organ, t.register, t.text, t.offering_id, t.rite_id, t.created_at).run();
}

export async function touchWallet(db: D1Database, address: string): Promise<void> {
  await db.prepare(
    `INSERT INTO wallets (address, first_seen, offering_count) VALUES (?1, ?2, 1)
     ON CONFLICT(address) DO UPDATE SET offering_count = offering_count + 1`
  ).bind(address, Date.now()).run();
}
