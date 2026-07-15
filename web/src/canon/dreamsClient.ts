import type { BodyCommand } from "../experience/types";
import { isTimestamp, type DreamArchiveEntry, type DreamView } from "../state/types";

// Same string cursor contract as the codex/relics clients: <created_at>:<ulid>. A malformed cursor is
// dropped (fetched as the newest page) rather than sent to the Worker, which would 400.
const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

export interface DreamPage {
  entries: DreamArchiveEntry[];
  next: string | null;
}

export type DreamPlateIdentityResult = "confirmed" | "mismatch" | "unavailable";
export type DreamArchiveRiteResult =
  | { status: "confirmed"; riteDate: string }
  | { status: "mismatch" }
  | { status: "unavailable" };

const IDENTITY_RETRY_INITIAL_MS = 500;
const IDENTITY_RETRY_MAX_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDreamArchiveEntry(value: unknown): value is DreamArchiveEntry {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.rite_date === "string"
    && typeof value.narrative === "string"
    && (value.video_key === null || typeof value.video_key === "string")
    && Array.isArray(value.wakers)
    && value.wakers.every((waker) => typeof waker === "string")
    && typeof value.status === "string"
    && isTimestamp(value.created_at);
}

function isDreamPage(value: unknown): value is DreamPage {
  return isRecord(value)
    && Array.isArray(value.entries)
    && value.entries.every(isDreamArchiveEntry)
    && (value.next === null || typeof value.next === "string");
}

export type DreamPlateRetryWait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function retryUnavailableDreamPlateIdentity(
  confirm: () => Promise<DreamPlateIdentityResult>,
  signal: AbortSignal,
  retryWait: DreamPlateRetryWait = waitForRetry,
): Promise<DreamPlateIdentityResult> {
  let retryDelay = IDENTITY_RETRY_INITIAL_MS;
  while (!signal.aborted) {
    const result = await confirm();
    if (result !== "unavailable") return result;
    await retryWait(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, IDENTITY_RETRY_MAX_MS);
  }
  return "unavailable";
}

export async function retryUnavailableDreamArchiveRite(
  confirm: () => Promise<DreamArchiveRiteResult>,
  signal: AbortSignal,
  retryWait: DreamPlateRetryWait = waitForRetry,
): Promise<DreamArchiveRiteResult> {
  let retryDelay = IDENTITY_RETRY_INITIAL_MS;
  while (!signal.aborted) {
    const result = await confirm();
    if (result.status !== "unavailable") return result;
    await retryWait(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, IDENTITY_RETRY_MAX_MS);
  }
  return { status: "unavailable" };
}

export async function fetchDreams(
  apiBase: string, cursor: string | null,
): Promise<DreamPage> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${apiBase}/api/dreams${q}`);
  if (!response.ok) throw new Error(`dreams fetch failed: ${response.status}`);
  const page: unknown = await response.json();
  if (!isDreamPage(page)) throw new Error("dreams fetch returned an invalid page");
  return page;
}

type LiveConvergence = Extract<BodyCommand, { kind: "converge" }>;

function liveConvergence(command: BodyCommand | null): LiveConvergence | null {
  return command?.kind === "converge" && command.dream.source === "live" ? command : null;
}

export function archiveRiteForCurrentDream(
  dream: DreamView | null,
  entries: readonly DreamArchiveEntry[],
): string | null {
  if (dream === null) return null;
  const matches = entries.filter((entry) => (
    entry.narrative === dream.narrative && entry.created_at === dream.created_at
  ));
  return matches.length === 1 ? matches[0].rite_date : null;
}

export function dreamArchiveIdentityKey(dream: DreamView): string {
  return JSON.stringify([dream.narrative, dream.created_at]);
}

export function dreamPlateIdentityKey(
  dream: DreamView | null,
  command: BodyCommand | null,
): string | null {
  const convergence = liveConvergence(command);
  if (
    dream === null
    || convergence === null
    || dream.narrative !== convergence.dream.narrative
  ) return null;
  return JSON.stringify([
    convergence.id,
    convergence.dream.id,
    convergence.dream.riteDate,
    convergence.dream.narrative,
    convergence.dream.createdAt,
    dream.narrative,
    dream.created_at,
  ]);
}

export function archiveConfirmsDreamPlate(
  dream: DreamView | null,
  command: BodyCommand | null,
  entries: readonly DreamArchiveEntry[],
): boolean {
  const convergence = liveConvergence(command);
  if (
    dream === null
    || convergence === null
    || dream.narrative !== convergence.dream.narrative
  ) return false;
  return entries.some((entry) => (
    entry.rite_date === convergence.dream.riteDate
    && entry.narrative === convergence.dream.narrative
    && entry.created_at === dream.created_at
  ));
}

export async function resolveDreamPlateIdentity(
  dream: DreamView | null,
  command: BodyCommand | null,
  page: Promise<unknown>,
): Promise<DreamPlateIdentityResult> {
  try {
    const result = await page;
    if (!isDreamPage(result)) return "unavailable";
    return archiveConfirmsDreamPlate(dream, command, result.entries)
      ? "confirmed"
      : "mismatch";
  } catch {
    return "unavailable";
  }
}

export async function resolveDreamArchiveRite(
  dream: DreamView | null,
  page: Promise<unknown>,
): Promise<DreamArchiveRiteResult> {
  if (dream === null) return { status: "mismatch" };
  try {
    const result = await page;
    if (!isDreamPage(result)) return { status: "unavailable" };
    const riteDate = archiveRiteForCurrentDream(dream, result.entries);
    return riteDate === null
      ? { status: "mismatch" }
      : { status: "confirmed", riteDate };
  } catch {
    return { status: "unavailable" };
  }
}

export type DreamPageLoader = (apiBase: string, cursor: null) => Promise<DreamPage>;

export class DreamPlateIdentityCache {
  private readonly confirmations = new Map<string, Promise<DreamPlateIdentityResult>>();
  private readonly pages = new Map<string, Promise<unknown>>();

  constructor(private readonly load: DreamPageLoader = fetchDreams) {}

  identifyCurrentRite(
    apiBase: string,
    dream: DreamView | null,
  ): Promise<DreamArchiveRiteResult> {
    if (dream === null) return Promise.resolve({ status: "mismatch" });
    return resolveDreamArchiveRite(dream, this.pageForDream(apiBase, dream));
  }

  confirm(
    apiBase: string,
    dream: DreamView | null,
    command: BodyCommand | null,
  ): Promise<DreamPlateIdentityResult> {
    const tuple = dreamPlateIdentityKey(dream, command);
    if (tuple === null) return Promise.resolve("mismatch");
    const convergence = liveConvergence(command);
    if (dream === null || convergence === null) return Promise.resolve("mismatch");
    const key = `${apiBase}\u0000${tuple}`;
    const cached = this.confirmations.get(key);
    if (cached !== undefined) return cached;
    const page = this.pageForDream(apiBase, dream);
    const confirmation = resolveDreamPlateIdentity(dream, convergence, page);
    this.confirmations.set(key, confirmation);
    void confirmation.then((result) => {
      if (result === "unavailable" && this.confirmations.get(key) === confirmation) {
        this.confirmations.delete(key);
      }
    });
    return confirmation;
  }

  private pageForDream(apiBase: string, dream: DreamView): Promise<unknown> {
    const key = `${apiBase}\u0000${dreamArchiveIdentityKey(dream)}`;
    const cached = this.pages.get(key);
    if (cached !== undefined) return cached;
    const page = Promise.resolve().then(() => this.load(apiBase, null));
    this.pages.set(key, page);
    void page.then(
      (result) => {
        if (!isDreamPage(result) && this.pages.get(key) === page) this.pages.delete(key);
      },
      () => {
        if (this.pages.get(key) === page) this.pages.delete(key);
      },
    );
    return page;
  }
}
