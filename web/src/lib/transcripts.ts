import type { TranscriptEntry } from "../state/types";

// The newest entry matching an exact organ/register pair, independent of the array's own order
// (the Codex feed is not guaranteed sorted from the caller's perspective) — shared by any organ's
// dedicated "home" section that needs its own latest utterance rather than the whole mixed feed.
export function latestByOrganRegister(
  entries: readonly TranscriptEntry[],
  organ: TranscriptEntry["organ"],
  register: TranscriptEntry["register"],
): TranscriptEntry | null {
  let latest: TranscriptEntry | null = null;
  for (const entry of entries) {
    if (entry.organ !== organ || entry.register !== register) continue;
    if (latest === null || entry.created_at > latest.created_at) latest = entry;
  }
  return latest;
}

// Plain, factual elapsed-time wording — no lore literacy required to understand "witnessed 2m ago".
// Falls back to a plain date past a day out, matching Dream's own long-past treatment.
export function elapsedLabel(createdAt: number, now: number): string {
  const ms = Math.max(0, now - createdAt);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "moments ago";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(createdAt).toISOString().slice(0, 10);
}
