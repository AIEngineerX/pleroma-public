import type { BodyCommand } from "../experience/types";
import type { DreamArchiveEntry, DreamView } from "../state/types";

// Same string cursor contract as the codex/relics clients: <created_at>:<ulid>. A malformed cursor is
// dropped (fetched as the newest page) rather than sent to the Worker, which would 400.
const CURSOR = /^\d+:[0-9A-HJKMNP-TV-Z]{26}$/;

export interface DreamPage {
  entries: DreamArchiveEntry[];
  next: string | null;
}

export async function fetchDreams(
  apiBase: string, cursor: string | null,
): Promise<DreamPage> {
  const q = cursor && CURSOR.test(cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return await (await fetch(`${apiBase}/api/dreams${q}`)).json();
}

type LiveConvergence = Extract<BodyCommand, { kind: "converge" }>;

function liveConvergence(command: BodyCommand | null): LiveConvergence | null {
  return command?.kind === "converge" && command.dream.source === "live" ? command : null;
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
  page: Promise<DreamPage>,
): Promise<boolean> {
  try {
    const result = await page;
    return Array.isArray(result.entries)
      && archiveConfirmsDreamPlate(dream, command, result.entries);
  } catch {
    return false;
  }
}

export type DreamPageLoader = (apiBase: string, cursor: null) => Promise<DreamPage>;

export class DreamPlateIdentityCache {
  private readonly confirmations = new Map<string, Promise<boolean>>();

  constructor(private readonly load: DreamPageLoader = fetchDreams) {}

  confirm(
    apiBase: string,
    dream: DreamView | null,
    command: BodyCommand | null,
  ): Promise<boolean> {
    const tuple = dreamPlateIdentityKey(dream, command);
    if (tuple === null) return Promise.resolve(false);
    const key = `${apiBase}\u0000${tuple}`;
    const cached = this.confirmations.get(key);
    if (cached !== undefined) return cached;
    let page: Promise<DreamPage>;
    try {
      page = this.load(apiBase, null);
    } catch (error) {
      page = Promise.reject(error);
    }
    const confirmation = resolveDreamPlateIdentity(dream, command, page);
    this.confirmations.set(key, confirmation);
    return confirmation;
  }
}
