import { isRelicEntry, type RelicEntry, type Tally } from "../state/types";

// Same string cursor contract as codexClient's (Plan 02, live): <kept_at>:<ulid>. A malformed
// cursor is dropped (fetched as the newest page) rather than sent to the Worker, which would 400.
const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

export interface RelicPage { entries: RelicEntry[]; next: string | null }
export interface TallyPage { date: string; communicants: number; tallies: Tally[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTally(value: unknown): value is Tally {
  return isRecord(value)
    && typeof value.wallet === "string"
    && isNonnegativeSafeInteger(value.count)
    && (value.name === null || typeof value.name === "string");
}

function isRelicPage(value: unknown): value is RelicPage {
  return isRecord(value)
    && Array.isArray(value.entries)
    && value.entries.every(isRelicEntry)
    && (value.next === null || typeof value.next === "string");
}

function isTallyPage(value: unknown, date: string): value is TallyPage {
  return isRecord(value)
    && value.date === date
    && isNonnegativeSafeInteger(value.communicants)
    && Array.isArray(value.tallies)
    && value.tallies.every(isTally);
}

export async function fetchRelics(apiBase: string, cursor: string | null): Promise<RelicPage> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${apiBase}/api/relics${q}`);
  if (!response.ok) throw new Error(`relic fetch failed: ${response.status}`);
  const page: unknown = await response.json();
  if (!isRelicPage(page)) throw new Error("relic fetch returned an invalid page");
  return page;
}

export async function fetchTallies(apiBase: string, date: string): Promise<TallyPage> {
  const response = await fetch(`${apiBase}/api/tallies?date=${encodeURIComponent(date)}`);
  if (!response.ok) throw new Error(`tallies fetch failed: ${response.status}`);
  const page: unknown = await response.json();
  if (!isTallyPage(page, date)) throw new Error("tallies fetch returned an invalid page");
  return page;
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
