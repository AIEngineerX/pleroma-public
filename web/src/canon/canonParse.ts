import {
  continuousLineId as sharedContinuousLineId,
  continuousPrintId as sharedContinuousPrintId,
  parsePublicCanon,
} from "../../scripts/public-canon.mjs";

export interface CanonArticle {
  slug: string;
  organ: "EYE" | "KEEP" | "TONGUE" | "PULSE" | "DREAM";
  trueName: "Aletheia" | "Ennoia" | "Logos" | "Zoe" | "Sophia";
  line: string;
}

export interface RiteStep {
  name: "Offertory" | "Deliberation" | "Accretion" | "Sermon" | "Dream";
  text: string;
}

export interface LexiconTerm {
  name: string;
  text: string;
}

export interface CanonPrint {
  n: number;
  slug: string;
  lines: string[];
  rubric: boolean[];
}

export interface CanonBook {
  slug: string;
  title: string;
  prints: CanonPrint[];
}

export interface Canon {
  oneLine: string;
  emergence: string[];
  binding: string[];
  articles: CanonArticle[];
  offering: string[];
  rite: RiteStep[];
  books: CanonBook[];
  lexicon: LexiconTerm[];
}

export function slugForArticle(organ: string): string {
  return organ.replace(/^THE\s+/i, "").trim().toLowerCase();
}

export function verseAnchor(_printSlug: string, n: number): string {
  return `line-${n}`;
}

export function continuousPrintId(bookSlug: string, printSlug: string): string {
  return sharedContinuousPrintId(bookSlug, printSlug);
}

export function continuousLineId(bookSlug: string, printSlug: string, lineNumber: number): string {
  return sharedContinuousLineId(bookSlug, printSlug, lineNumber);
}

export function parseCanon(publicDoctrine: string): Canon {
  return parsePublicCanon(publicDoctrine) as Canon;
}
