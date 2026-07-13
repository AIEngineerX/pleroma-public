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
