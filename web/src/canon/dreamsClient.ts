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
export const DREAM_REQUEST_TIMEOUT_MS = 5_000;

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

export interface DreamFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function boundedRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup(): void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Dream request timeout must be a positive finite number");
  }
  const controller = new AbortController();
  const relayAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) relayAbort();
  else parent?.addEventListener("abort", relayAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Dream request timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", relayAbort);
    },
  };
}

export async function fetchDreams(
  apiBase: string,
  cursor: string | null,
  options: DreamFetchOptions = {},
): Promise<DreamPage> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const request = boundedRequestSignal(
    options.signal,
    options.timeoutMs ?? DREAM_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${apiBase}/api/dreams${q}`, { signal: request.signal });
    if (!response.ok) throw new Error(`dreams fetch failed: ${response.status}`);
    const page: unknown = await response.json();
    if (!isDreamPage(page)) throw new Error("dreams fetch returned an invalid page");
    return page;
  } finally {
    request.cleanup();
  }
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

export type DreamPageLoader = (
  apiBase: string,
  cursor: null,
  signal: AbortSignal,
) => Promise<DreamPage>;

interface DreamPageCacheEntry {
  controller: AbortController;
  consumers: Set<symbol>;
  promise: Promise<unknown>;
  settled: boolean;
}

type DreamConfirmationCacheEntry = DreamPlateIdentityResult | Promise<DreamPlateIdentityResult>;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Dream request aborted", "AbortError");
}

function consumeWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function loadDreamPage(apiBase: string, cursor: null, signal: AbortSignal): Promise<DreamPage> {
  return fetchDreams(apiBase, cursor, { signal });
}

export class DreamPlateIdentityCache {
  private readonly confirmations = new Map<string, DreamConfirmationCacheEntry>();
  private readonly pages = new Map<string, DreamPageCacheEntry>();

  constructor(private readonly load: DreamPageLoader = loadDreamPage) {}

  identifyCurrentRite(
    apiBase: string,
    dream: DreamView | null,
    signal?: AbortSignal,
  ): Promise<DreamArchiveRiteResult> {
    if (dream === null) return Promise.resolve({ status: "mismatch" });
    return resolveDreamArchiveRite(dream, this.pageForDream(apiBase, dream, signal));
  }

  confirm(
    apiBase: string,
    dream: DreamView | null,
    command: BodyCommand | null,
    signal?: AbortSignal,
  ): Promise<DreamPlateIdentityResult> {
    const tuple = dreamPlateIdentityKey(dream, command);
    if (tuple === null) return Promise.resolve("mismatch");
    const convergence = liveConvergence(command);
    if (dream === null || convergence === null) return Promise.resolve("mismatch");
    const key = `${apiBase}\u0000${tuple}`;
    const cached = this.confirmations.get(key);
    if (typeof cached === "string") return Promise.resolve(cached);
    if (cached !== undefined) {
      if (signal === undefined) return cached;
      return consumeWithSignal(cached, signal).catch(() => "unavailable");
    }
    const page = this.pageForDream(apiBase, dream, signal);
    const confirmation = resolveDreamPlateIdentity(dream, convergence, page);
    if (signal === undefined) this.confirmations.set(key, confirmation);
    void confirmation.then((result) => {
      if (result === "unavailable") {
        if (this.confirmations.get(key) === confirmation) this.confirmations.delete(key);
      } else {
        this.confirmations.set(key, result);
      }
    });
    return confirmation;
  }

  private pageForDream(
    apiBase: string,
    dream: DreamView,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const key = `${apiBase}\u0000${dreamArchiveIdentityKey(dream)}`;
    let entry = this.pages.get(key);
    if (entry === undefined) {
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => this.load(apiBase, null, controller.signal));
      entry = {
        controller,
        consumers: new Set(),
        promise,
        settled: false,
      };
      this.pages.set(key, entry);
      const createdEntry = entry;
      void promise.then(
        (result) => {
          createdEntry.settled = true;
          if (!isDreamPage(result) && this.pages.get(key) === createdEntry) {
            this.pages.delete(key);
          }
        },
        () => {
          createdEntry.settled = true;
          if (this.pages.get(key) === createdEntry) this.pages.delete(key);
        },
      );
    }

    const consumer = Symbol("dream-page-consumer");
    entry.consumers.add(consumer);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.consumers.delete(consumer);
      if (!entry.settled && entry.consumers.size === 0) {
        if (this.pages.get(key) === entry) this.pages.delete(key);
        entry.controller.abort(new DOMException("Dream page has no consumers", "AbortError"));
      }
    };
    const page = signal === undefined
      ? entry.promise
      : consumeWithSignal(entry.promise, signal);
    return page.finally(release);
  }
}
