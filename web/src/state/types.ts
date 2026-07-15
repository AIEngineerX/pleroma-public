export type PulseState = "starving" | "calm" | "fed" | "feasting";
export type RitePhase =
  | "scheduled" | "offertory_close" | "deliberation" | "accretion" | "sermon" | "complete" | "failed";
export interface Vitals { state: PulseState; buys: number; sells: number; holders: number }
export interface RiteView { date: string; phase: RitePhase }
export interface DreamView { narrative: string; video_key: string | null; wakers: string[]; created_at: number }
export interface DreamArchiveEntry {
  id: string; rite_date: string; narrative: string; video_key: string | null;
  wakers: string[]; status: string; created_at: number;
}
export interface TempleState {
  phase: "dormant" | "live"; asleep: boolean; degraded: boolean;
  countdown_to: number | null; communicants_today: number; spend_state: "ok" | "asleep";
  mint: string | null; vitals: Vitals; rite: RiteView | null; dream: DreamView | null;
}
export interface TranscriptEntry {
  id: string; organ: "EYE" | "KEEP" | "TONGUE" | "PULSE" | "DREAM" | "PRIEST";
  register: "verse" | "verdict" | "sermon" | "telemetry" | "system";
  text: string; offering_id: string | null; rite_id: string | null; created_at: number;
}
export interface RelicEntry {
  id: string; offering_id: string; wallet: string | null; summary: string;
  rite_id: string | null; kept_at: number; genesis: number; accreted_at: number | null;
}
export interface Tally { wallet: string; count: number; name: string | null }

export const MAX_DATE_TIMESTAMP = 8.64e15;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isTimestamp(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= MAX_DATE_TIMESTAMP;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isVitals(value: unknown): value is Vitals {
  if (!isRecord(value)) return false;
  return ["starving", "calm", "fed", "feasting"].includes(String(value.state))
    && isFiniteNumber(value.buys)
    && isFiniteNumber(value.sells)
    && isFiniteNumber(value.holders);
}

export function isTempleState(value: unknown): value is TempleState {
  if (!isRecord(value)) return false;
  const rite = value.rite;
  const dream = value.dream;
  const validRite = rite === null || (isRecord(rite)
    && typeof rite.date === "string"
    && ["scheduled", "offertory_close", "deliberation", "accretion", "sermon", "complete", "failed"].includes(String(rite.phase)));
  const validDream = dream === null || (isRecord(dream)
    && typeof dream.narrative === "string"
    && isNullableString(dream.video_key)
    && Array.isArray(dream.wakers)
    && dream.wakers.every((waker) => typeof waker === "string")
    && isTimestamp(dream.created_at));
  return (value.phase === "dormant" || value.phase === "live")
    && typeof value.asleep === "boolean"
    && typeof value.degraded === "boolean"
    && (value.countdown_to === null || isTimestamp(value.countdown_to))
    && isFiniteNumber(value.communicants_today)
    && (value.spend_state === "ok" || value.spend_state === "asleep")
    && isNullableString(value.mint)
    && isVitals(value.vitals)
    && validRite
    && validDream;
}

export function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && ["EYE", "KEEP", "TONGUE", "PULSE", "DREAM", "PRIEST"].includes(String(value.organ))
    && ["verse", "verdict", "sermon", "telemetry", "system"].includes(String(value.register))
    && typeof value.text === "string"
    && isNullableString(value.offering_id)
    && isNullableString(value.rite_id)
    && isTimestamp(value.created_at);
}

export function isRelicEntry(value: unknown): value is RelicEntry {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.offering_id === "string"
    && isNullableString(value.wallet)
    && typeof value.summary === "string"
    && isNullableString(value.rite_id)
    && isTimestamp(value.kept_at)
    && isFiniteNumber(value.genesis)
    && (value.accreted_at === null || isTimestamp(value.accreted_at));
}
