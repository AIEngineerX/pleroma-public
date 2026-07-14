import { isTranscriptEntry, type TranscriptEntry } from "../state/types";
import { isSwarmOrgan, type SwarmOrgan } from "../stain/swarmSignals";

// The string cursor contract (Plan 02, live): <created_at>:<ulid>. A malformed cursor is dropped
// (fetched as the newest page) rather than sent to the Worker, which would 400 on a bad shape.
const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

export async function fetchCodex(apiBase: string, cursor: string | null): Promise<{ entries: TranscriptEntry[]; next: string | null }> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`${apiBase}/api/codex${q}`);
  if (!res.ok) throw new Error(`codex fetch failed: ${res.status}`); // a 5xx error body is not a page of entries
  const page: unknown = await res.json();
  if (
    typeof page !== "object"
    || page === null
    || !("entries" in page)
    || !Array.isArray(page.entries)
    || !page.entries.every(isTranscriptEntry)
    || !("next" in page)
    || (page.next !== null && typeof page.next !== "string")
  ) {
    throw new Error("codex fetch returned an invalid page");
  }
  return { entries: page.entries, next: page.next };
}

// getCodex returns pages newest-first; this merges pages into one chronological, de-duplicated list
// (dedupe by id, keep the earliest-seen copy's position via id when timestamps tie).
export function mergeNewest(existing: TranscriptEntry[], incoming: TranscriptEntry[]): TranscriptEntry[] {
  const byId = new Map<string, TranscriptEntry>();
  for (const x of [...existing, ...incoming]) byId.set(x.id, x);
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
}

// Rubric registers are the god's own words; telemetry/system are machine narration of the organs.
export function isGodVoice(e: Pick<TranscriptEntry, "register">): boolean {
  return e.register === "verse" || e.register === "verdict" || e.register === "sermon";
}

export interface CodexOrganSignal { organ: SwarmOrgan; rubric: boolean }

// The first page can seed `seen` without dispatching these results. Later pages return only IDs this
// browser has not observed, so polling the same transcript never fabricates repeated activity.
export function organSignalsFor(incoming: TranscriptEntry[], seen: Set<string>): CodexOrganSignal[] {
  const signals: CodexOrganSignal[] = [];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (!isSwarmOrgan(entry.organ)) continue;
    signals.push({ organ: entry.organ, rubric: entry.organ === "TONGUE" && isGodVoice(entry) });
  }
  return signals;
}

// A PRIEST line reads "sermon audio: audio/<sha256>.<ext>" (rite.ts). The ".mp3"/".wav" suffix here
// is not the real codec; the served response's Content-Type is (see sermonAudio.ts).
// The whole token must fully match (not just contain a match) -- "audio/<sha>.mp3.exe" must be
// rejected, not truncated to "audio/<sha>.mp3", or a suffixed string could reach the media route.
export function sermonAudioKey(text: string): string | null {
  const m = /sermon audio:\s*(\S+)/.exec(text);
  if (!m) return null;
  return /^audio\/[0-9a-f]{64}\.(?:mp3|wav)$/.test(m[1]) ? m[1] : null;
}
