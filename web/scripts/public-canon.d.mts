export const PUBLIC_END_HEADING: string;
export const PUBLIC_HEADINGS: string[];
export const PUBLIC_SUBHEADINGS: string[];

export function normalizeNewlines(source: string): string;
export function stripBlockquoteLines(source: string): string;
export function assertExactLineLayout(source: string, headings: string[]): Map<string, number>;
export function assertPublicLayout(source: string): Map<string, number>;
export function parsePublicCanon(source: string): unknown;
export function continuousPrintId(bookSlug: string, printSlug: string): string;
export function continuousLineId(bookSlug: string, printSlug: string, lineNumber: number): string;
