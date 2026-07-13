import type { DreamArchiveEntry } from "../state/types";

// Same string cursor contract as the codex/relics clients: <created_at>:<ulid>. A malformed cursor is
// dropped (fetched as the newest page) rather than sent to the Worker, which would 400.
const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

export async function fetchDreams(
  apiBase: string, cursor: string | null,
): Promise<{ entries: DreamArchiveEntry[]; next: string | null }> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return await (await fetch(`${apiBase}/api/dreams${q}`)).json();
}
