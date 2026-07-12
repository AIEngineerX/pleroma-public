// Pure parser for the Canon: reads root DOCTRINE.md (the single lore source) and extracts the
// one line, the five Articles (§II), and the Books/Prints/Lines (§III), verbatim. No paraphrasing,
// reordering, or rewriting -- this file only extracts spans of the source text. Shared by the
// build-time prerender (scripts/build-canon.mjs, which inlines the same regexes for a TS-free
// build step) and the client <Canon/> route, so both render exactly the same scripture.

export interface CanonArticle {
  slug: string;
  organ: string;
  line: string;
}

export interface CanonPrint {
  n: number;
  slug: string;
  lines: string[];
  // Parallel to `lines`: true where DOCTRINE marks that line ⟨rubric⟩ (the god's own words, not
  // "the page's own account" -- DOCTRINE §III). Only rubric-marked lines render in rubric red.
  rubric: boolean[];
}

export interface CanonBook {
  slug: string;
  title: string;
  prints: CanonPrint[];
}

export interface Canon {
  oneLine: string;
  articles: CanonArticle[];
  books: CanonBook[];
}

export function slugForArticle(organ: string): string {
  return organ.replace(/^THE\s+/i, "").trim().toLowerCase();
}

export function verseAnchor(_printSlug: string, n: number): string {
  return `line-${n}`;
}

function clean(s: string): string {
  return s.replace(/⟨rubric⟩/g, "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim().replace(/^"|"$/g, "");
}

export function parseCanon(md: string): Canon {
  const oneM = /before all others:\s*\n+\s*⟨rubric⟩\s*\*\*"([^"]+)"\*\*/.exec(md);
  const oneLine = oneM ? oneM[1] : "";

  // §II Articles: "1. **THE EYE** — ⟨rubric⟩ *"..."*" (the leading digit excludes THE CONCORDAT,
  // which binds the five but is not one of them).
  const articles: CanonArticle[] = [];
  for (const m of md.matchAll(/^\d+\.\s+\*\*(THE [A-Z]+)\*\*\s+[—-]\s+⟨rubric⟩\s*\*"([^"]+)"\*/gm)) {
    articles.push({ slug: slugForArticle(m[1]), organ: m[1], line: clean(m[2]) });
  }

  // §III Books/Prints: "**BOOK OF FIRST LIGHT · PRINT 1 · LINES 1–5**" then numbered "1. ..." lines.
  const books: CanonBook[] = [];
  const printRe = /\*\*BOOK OF ([A-Z ]+?) · PRINT (\d+) · LINES [\d–\-]+\*\*\s*([\s\S]*?)(?=\n\*\*BOOK OF|\n##|\n---|$)/g;
  for (const m of md.matchAll(printRe)) {
    const title = m[1].trim();
    const slug = title.toLowerCase().replace(/\s+/g, "-");
    const n = Number(m[2]);
    const rawLines = [...m[3].matchAll(/^\s*\d+\.\s+(.*)$/gm)].map(l => l[1]).filter(l => clean(l).length > 0);
    const lines = rawLines.map(clean);
    const rubric = rawLines.map(l => /⟨rubric⟩/.test(l));
    let book = books.find(b => b.slug === slug);
    if (!book) {
      book = { slug, title: `Book of ${title.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}`, prints: [] };
      books.push(book);
    }
    book.prints.push({ n, slug: `print-${n}`, lines, rubric });
  }
  return { oneLine, articles, books };
}
