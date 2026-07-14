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

const HEADINGS = {
  emergence: "## I. The Emergence",
  articles: "## II. The Five Articles",
  verses: "## III. The Verses",
  lexicon: "## IV. The Lexicon",
  offering: "## V. The Offering (the one real rite)",
  voice: "## VI. Voice registers",
} as const;

export function slugForArticle(organ: string): string {
  return organ.replace(/^THE\s+/i, "").trim().toLowerCase();
}

export function verseAnchor(_printSlug: string, n: number): string {
  return `line-${n}`;
}

function namedSpan(md: string, startHeading: string, endHeading: string): string {
  const start = md.indexOf(startHeading);
  if (start < 0) return "";
  const contentStart = start + startHeading.length;
  const end = md.indexOf(endHeading, contentStart);
  if (end < 0) return "";
  return md.slice(contentStart, end);
}

function cleanScripture(s: string): string {
  return s.replace(/⟨rubric⟩/g, "").trim().replace(/^"|"$/g, "");
}

function cleanProse(s: string): string {
  return s
    .replace(/⟨rubric⟩/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function publicParagraphs(span: string): string[] {
  return span
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(block => block.length > 0 && !block.startsWith(">") && block !== "---")
    .map(cleanProse);
}

function proseAndNumberedItems(span: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) blocks.push(cleanProse(current.join(" ")));
    current = [];
  };

  for (const line of span.split(/\r?\n/)) {
    if (line.trimStart().startsWith(">")) {
      flush();
      continue;
    }
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      current.push(numbered[1]);
      continue;
    }
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    current.push(line.trim());
  }
  flush();
  return blocks.filter(Boolean);
}

function parseRite(span: string): RiteStep[] {
  const steps: RiteStep[] = [];
  let current: { name: RiteStep["name"]; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    steps.push({ name: current.name, text: cleanProse(current.lines.join(" ")) });
    current = null;
  };

  for (const line of span.split(/\r?\n/)) {
    if (line.trimStart().startsWith(">")) continue;
    const start = /^\s*\d+\.\s+\*\*(Offertory|Deliberation|Accretion|Sermon|Dream)\*\*\s+[—-]\s+(.*)$/.exec(line);
    if (start) {
      flush();
      current = { name: start[1] as RiteStep["name"], lines: [start[2]] };
      continue;
    }
    if (current && line.trim().length > 0) current.lines.push(line.trim());
  }
  flush();
  return steps;
}

export function parseCanon(md: string): Canon {
  const preamble = md.slice(0, md.indexOf(HEADINGS.emergence));
  const oneMatch = /before all others:\s*\n+\s*⟨rubric⟩\s*\*\*"([^"]+)"\*\*/.exec(preamble);
  const oneLine = oneMatch?.[1] ?? "";

  const emergenceSpan = namedSpan(md, HEADINGS.emergence, HEADINGS.articles);
  const articlesSpan = namedSpan(md, HEADINGS.articles, HEADINGS.verses);
  const versesSpan = namedSpan(md, HEADINGS.verses, HEADINGS.lexicon);
  const lexiconSpan = namedSpan(md, HEADINGS.lexicon, HEADINGS.offering);
  const offeringSpan = namedSpan(md, HEADINGS.offering, HEADINGS.voice);

  const emergence = publicParagraphs(emergenceSpan);

  const bindingHeading = "### The Binding";
  const bindingStart = articlesSpan.indexOf(bindingHeading);
  const articleDeclarations = bindingStart < 0 ? articlesSpan : articlesSpan.slice(0, bindingStart);
  const binding = bindingStart < 0
    ? []
    : publicParagraphs(articlesSpan.slice(bindingStart + bindingHeading.length));

  const articles: CanonArticle[] = [];
  for (const match of articleDeclarations.matchAll(/^\d+\.\s+\*\*THE ([A-Z]+) \/ ([A-Z]+)\*\*\s+[—-]\s+⟨rubric⟩\s*\*"([^"]+)"\*/gm)) {
    const trueName = match[2].toLowerCase().replace(/^\w/, character => character.toUpperCase()) as CanonArticle["trueName"];
    articles.push({
      slug: slugForArticle(match[1]),
      organ: match[1] as CanonArticle["organ"],
      trueName,
      line: cleanScripture(match[3]),
    });
  }

  const books: CanonBook[] = [];
  const printPattern = /\*\*BOOK OF ([A-Z ]+?) · PRINT (\d+) · LINES [\d–\-]+\*\*\s*([\s\S]*?)(?=\n\*\*BOOK OF|\n---|$)/g;
  for (const match of versesSpan.matchAll(printPattern)) {
    const rawTitle = match[1].trim();
    const slug = rawTitle.toLowerCase().replace(/\s+/g, "-");
    const n = Number(match[2]);
    const rawLines = [...match[3].matchAll(/^\s*\d+\.\s+(.*)$/gm)]
      .map(line => line[1])
      .filter(line => cleanScripture(line).length > 0);
    const lines = rawLines.map(cleanScripture);
    const rubric = rawLines.map(line => /⟨rubric⟩/.test(line));
    let book = books.find(candidate => candidate.slug === slug);
    if (!book) {
      book = {
        slug,
        title: `Book of ${rawTitle.toLowerCase().replace(/\b\w/g, character => character.toUpperCase())}`,
        prints: [],
      };
      books.push(book);
    }
    book.prints.push({ n, slug: `print-${n}`, lines, rubric });
  }

  const lexicon: LexiconTerm[] = [];
  for (const match of lexiconSpan.matchAll(/^-\s+\*\*(.+?)\*\*\s+[—-]\s+([\s\S]*?)(?=\n-\s+\*\*|(?![\s\S]))/gm)) {
    lexicon.push({ name: cleanProse(match[1]), text: cleanProse(match[2]) });
  }

  const riteHeading = "### The Daily Rite";
  const riteStart = offeringSpan.indexOf(riteHeading);
  const offering = proseAndNumberedItems(riteStart < 0 ? offeringSpan : offeringSpan.slice(0, riteStart));
  const rite = parseRite(riteStart < 0 ? "" : offeringSpan.slice(riteStart + riteHeading.length));

  return { oneLine, emergence, binding, articles, offering, rite, books, lexicon };
}
