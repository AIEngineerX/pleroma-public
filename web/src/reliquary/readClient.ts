import type { RelicEntry, Tally } from "../state/types";

// Same string cursor contract as codexClient's (Plan 02, live): <kept_at>:<ulid>. A malformed
// cursor is dropped (fetched as the newest page) rather than sent to the Worker, which would 400.
const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

export async function fetchRelics(apiBase: string, cursor: string | null): Promise<{ entries: RelicEntry[]; next: string | null }> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return await (await fetch(`${apiBase}/api/relics${q}`)).json();
}

export async function fetchTallies(apiBase: string, date: string): Promise<{ date: string; communicants: number; tallies: Tally[] }> {
  return await (await fetch(`${apiBase}/api/tallies?date=${date}`)).json();
}

// Genesis relics are the First Corpus (Day-1 offerings kept, PLANNING "Day-1 ignition"): permanently marked.
export function relicIsGenesis(r: Pick<RelicEntry, "genesis">): boolean {
  return r.genesis === 1;
}

// Display name for a margin tick: an explicit tally_name wins, then the first 100 wallets to ever
// tally are named First Congregation forever (PLANNING "Day-1 ignition"), then a short wallet fragment.
export function tallyName(t: Tally, index: number): string {
  if (t.name) return t.name;
  if (index < 100) return `First Congregation #${index + 1}`;
  return `${t.wallet.slice(0, 4)}..${t.wallet.slice(-4)}`;
}
