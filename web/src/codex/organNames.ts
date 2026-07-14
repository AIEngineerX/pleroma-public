import type { TranscriptEntry } from "../state/types";

const COMMON_NAMES: Readonly<Record<TranscriptEntry["organ"], string>> = {
  EYE: "THE EYE",
  KEEP: "THE KEEP",
  TONGUE: "THE TONGUE",
  PULSE: "THE PULSE",
  DREAM: "THE DREAM",
  PRIEST: "THE PRIEST",
};

export function commonOrganName(organ: TranscriptEntry["organ"]): string {
  return COMMON_NAMES[organ];
}

export function spokenOrganName(organ: TranscriptEntry["organ"]): string {
  const common = COMMON_NAMES[organ].slice(4).toLocaleLowerCase("en-US");
  return common.charAt(0).toLocaleUpperCase("en-US") + common.slice(1);
}

export function formatTranscriptTime(createdAt: number): string {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(createdAt));
}
